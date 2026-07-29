import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, sha256 } from "../story-system/commit.js";
import type { ChapterCommit } from "../story-system/types.js";
import { storySpecRoot } from "../story-spec/constitution-loader.js";
import type { DynamicOutlineRevision, OutlineChange } from "./types.js";

export class DynamicOutlineRevisionStore {
  readonly root: string;

  constructor(bookDir: string) {
    this.root = join(storySpecRoot(bookDir), "amendments", "dynamic-outline");
  }

  async propose(params: {
    readonly bookId: string;
    readonly triggeredByCommitId: string;
    readonly affectedSpecIds: ReadonlyArray<string>;
    readonly proposedChanges: ReadonlyArray<OutlineChange>;
    readonly reasons: ReadonlyArray<string>;
    readonly requiresHumanApproval?: boolean;
  }): Promise<DynamicOutlineRevision> {
    const basis = {
      bookId: params.bookId,
      triggeredByCommitId: params.triggeredByCommitId,
      affectedSpecIds: [...params.affectedSpecIds].sort(),
      proposedChanges: params.proposedChanges,
      reasons: params.reasons,
    };
    const id = `outline-revision-${sha256(canonicalJson(basis)).slice(0, 28)}`;
    const existing = await this.load(id);
    if (existing) return existing;
    const revision: DynamicOutlineRevision = {
      id,
      ...basis,
      requiresHumanApproval: params.requiresHumanApproval ?? true,
      status: "proposed",
      createdAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.path(id), revision);
    return revision;
  }

  async decide(
    id: string,
    decision: "approved" | "rejected",
  ): Promise<DynamicOutlineRevision> {
    const current = await this.loadRequired(id);
    if (current.status !== "proposed") {
      throw new Error(`Dynamic outline revision ${id} is already ${current.status}`);
    }
    const next: DynamicOutlineRevision = {
      ...current,
      status: decision,
      decidedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.path(id), next);
    return next;
  }

  async markApplied(id: string): Promise<DynamicOutlineRevision> {
    const current = await this.loadRequired(id);
    if (current.status !== "approved") throw new Error(`Revision ${id} must be approved before apply`);
    const next: DynamicOutlineRevision = { ...current, status: "applied" };
    await writeJsonAtomic(this.path(id), next);
    return next;
  }

  async load(id: string): Promise<DynamicOutlineRevision | null> {
    const raw = await readFile(this.path(id), "utf-8").catch(() => "");
    return raw ? JSON.parse(raw) as DynamicOutlineRevision : null;
  }

  async list(): Promise<ReadonlyArray<DynamicOutlineRevision>> {
    const names = (await readdir(this.root).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
    return Promise.all(names.map(async (name) =>
      JSON.parse(await readFile(join(this.root, name), "utf-8")) as DynamicOutlineRevision));
  }

  private async loadRequired(id: string): Promise<DynamicOutlineRevision> {
    const revision = await this.load(id);
    if (!revision) throw new Error(`Dynamic outline revision ${id} not found`);
    return revision;
  }

  private path(id: string): string {
    if (!/^outline-revision-[a-f0-9]+$/.test(id)) throw new Error(`Unsafe outline revision id: ${id}`);
    return join(this.root, `${id}.json`);
  }
}

export async function proposeOutlineRevisionFromCommit(params: {
  readonly bookDir: string;
  readonly commit: ChapterCommit;
  readonly futureSpecIds: ReadonlyArray<string>;
}): Promise<DynamicOutlineRevision | null> {
  const signals = collectRevisionSignals(params.commit);
  if (signals.length === 0 || params.futureSpecIds.length === 0) return null;
  return new DynamicOutlineRevisionStore(params.bookDir).propose({
    bookId: params.commit.bookId,
    triggeredByCommitId: params.commit.commitId,
    affectedSpecIds: params.futureSpecIds,
    proposedChanges: params.futureSpecIds.map((specId) => ({
      specId,
      field: "staleReason",
      oldValue: null,
      newValue: `Re-evaluate after ${params.commit.commitId}: ${signals.join("; ")}`,
    })),
    reasons: signals,
    requiresHumanApproval: true,
  });
}

export async function listFutureSpecIds(
  bookDir: string,
  afterChapter: number,
): Promise<ReadonlyArray<string>> {
  const raw = await readFile(join(storySpecRoot(bookDir), "HEAD"), "utf-8").catch(() => "");
  if (!raw) return [];
  const head = JSON.parse(raw) as { chapters?: Record<string, { id?: unknown; status?: unknown }> };
  return Object.entries(head.chapters ?? {})
    .filter(([chapter, value]) =>
      Number(chapter) > afterChapter
      && value.status !== "superseded"
      && typeof value.id === "string")
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, value]) => String(value.id));
}

function collectRevisionSignals(commit: ChapterCommit): ReadonlyArray<string> {
  const eventSignals = commit.events.flatMap((event) => {
    if (event.eventType === "relationship_changed") return [`关系变化：${event.subject} → ${event.object ?? ""}`];
    if (event.eventType === "open_loop_closed") return [`伏笔窗口关闭：${event.subject}`];
    if (event.eventType === "reader_promise_paid_off") return [`读者承诺已兑现：${event.subject}`];
    if (event.eventType === "world_rule_broken") return [`世界规则被打破：${event.subject}`];
    return [];
  });
  const stateSignals = commit.stateDeltas
    .filter((delta) => /goal|strategy|目标|策略|关系|risk|风险/i.test(delta.predicate))
    .map((delta) => `${delta.subject}.${delta.predicate} 已变化`);
  return [...new Set([...eventSignals, ...stateSignals])];
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

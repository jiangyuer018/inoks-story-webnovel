import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, sha256 } from "../story-system/commit.js";
import type { ChapterCommit } from "../story-system/types.js";
import { storySpecRoot } from "../story-spec/constitution-loader.js";
import { StorySpecStore } from "../story-spec/spec-store.js";
import type { AcceptanceCriterion, ChapterSpec } from "../story-spec/types.js";
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
  const specs = await loadSpecsByIds(params.bookDir, params.futureSpecIds);
  if (specs.length === 0) return null;
  const canonConstraints = signals.map((signal) => `正史承接：${signal}；不得按变化前状态推进`);
  const canonCriteria: AcceptanceCriterion[] = signals.map((signal, index) => ({
    id: `canon-${params.commit.commitId.slice(-10)}-${index + 1}`,
    description: `后续场景必须用行动、选择或后果承接：${signal}`,
    severity: "blocking",
    evidenceTerms: extractSignalTerms(signal),
  }));
  return new DynamicOutlineRevisionStore(params.bookDir).propose({
    bookId: params.commit.bookId,
    triggeredByCommitId: params.commit.commitId,
    affectedSpecIds: specs.map((spec) => spec.id),
    proposedChanges: specs.flatMap((spec) => ([
      {
        specId: spec.id,
        field: "hardConstraints",
        oldValue: spec.hardConstraints,
        newValue: unique([...spec.hardConstraints, ...canonConstraints]),
      },
      {
        specId: spec.id,
        field: "plannedEvents",
        oldValue: spec.plannedEvents,
        newValue: unique([...spec.plannedEvents, ...signals.map((signal) => `承接既成事实：${signal}`)]),
      },
      {
        specId: spec.id,
        field: "acceptanceCriteria",
        oldValue: spec.acceptanceCriteria,
        newValue: uniqueById([...spec.acceptanceCriteria, ...canonCriteria]),
      },
    ])),
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

export async function approveAndApplyOutlineRevision(
  bookDir: string,
  id: string,
): Promise<DynamicOutlineRevision> {
  const revisions = new DynamicOutlineRevisionStore(bookDir);
  const current = await revisions.load(id);
  if (!current) throw new Error(`Dynamic outline revision ${id} not found`);
  const approved = current.status === "proposed"
    ? await revisions.decide(id, "approved")
    : current;
  if (approved.status === "applied") return approved;
  if (approved.status !== "approved") {
    throw new Error(`Dynamic outline revision ${id} is ${approved.status}, not approved`);
  }

  const headRaw = await readFile(join(storySpecRoot(bookDir), "HEAD"), "utf-8").catch(() => "");
  const head = headRaw
    ? JSON.parse(headRaw) as { chapters?: Record<string, { id?: unknown }> }
    : {};
  const chaptersBySpecId = new Map(
    Object.entries(head.chapters ?? {})
      .filter((entry): entry is [string, { id: string }] => typeof entry[1].id === "string")
      .map(([chapter, value]) => [value.id, Number(chapter)]),
  );
  const store = new StorySpecStore(bookDir);
  for (const specId of approved.affectedSpecIds) {
    const chapter = chaptersBySpecId.get(specId);
    if (!chapter) continue;
    const currentSpec = await store.loadChapter(chapter);
    if (!currentSpec) continue;
    const changes = approved.proposedChanges.filter((change) => change.specId === specId);
    const patched = applyOutlineChanges(currentSpec, changes);
    await store.saveChapter({
      ...patched,
      version: currentSpec.version + 1,
      status: "stale",
      approvedAt: undefined,
      approvedBy: undefined,
      createdAt: new Date().toISOString(),
    });
  }
  return revisions.markApplied(id);
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
    .map((delta) => `${delta.subject}.${delta.predicate}：${canonicalJson(delta.oldValue)} → ${canonicalJson(delta.newValue)}`);
  return [...new Set([...eventSignals, ...stateSignals])];
}

async function loadSpecsByIds(
  bookDir: string,
  specIds: ReadonlyArray<string>,
): Promise<ReadonlyArray<ChapterSpec>> {
  const requested = new Set(specIds);
  const raw = await readFile(join(storySpecRoot(bookDir), "HEAD"), "utf-8").catch(() => "");
  if (!raw) return [];
  const head = JSON.parse(raw) as { chapters?: Record<string, { id?: unknown }> };
  const store = new StorySpecStore(bookDir);
  const specs = await Promise.all(Object.entries(head.chapters ?? {})
    .filter(([, value]) => typeof value.id === "string" && requested.has(value.id))
    .map(([chapter]) => store.loadChapter(Number(chapter))));
  return specs.filter((spec): spec is ChapterSpec => Boolean(spec));
}

function applyOutlineChanges(spec: ChapterSpec, changes: ReadonlyArray<OutlineChange>): ChapterSpec {
  let next = spec;
  for (const change of changes) {
    if (change.field === "hardConstraints" && isStringArray(change.newValue)) {
      next = { ...next, hardConstraints: unique(change.newValue) };
    } else if (change.field === "plannedEvents" && isStringArray(change.newValue)) {
      next = { ...next, plannedEvents: unique(change.newValue) };
    } else if (change.field === "acceptanceCriteria" && Array.isArray(change.newValue)) {
      const criteria = change.newValue.filter(isAcceptanceCriterion);
      if (criteria.length === change.newValue.length) next = { ...next, acceptanceCriteria: uniqueById(criteria) };
    }
  }
  return next;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isAcceptanceCriterion(value: unknown): value is AcceptanceCriterion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.description === "string"
    && (item.severity === "blocking" || item.severity === "advisory")
    && Array.isArray(item.evidenceTerms)
    && item.evidenceTerms.every((term) => typeof term === "string" && term.trim().length > 0);
}

function extractSignalTerms(signal: string): string[] {
  return unique(signal.match(/[\p{Script=Han}A-Za-z0-9_-]{2,}/gu) ?? []).slice(0, 8);
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueById<T extends { readonly id: string }>(values: ReadonlyArray<T>): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChapterCommit, StoryEvent } from "../story-system/types.js";

export type PayoffStatus =
  | "created"
  | "reinforced"
  | "delayed"
  | "threatened"
  | "partially_paid"
  | "paid_off"
  | "transformed"
  | "abandoned";

export interface PayoffBuildUp {
  readonly chapter: number;
  readonly eventId: string;
  readonly action: PayoffStatus;
  readonly evidence: ReadonlyArray<string>;
}

export interface PayoffEntry {
  readonly id: string;
  readonly bookId: string;
  readonly type: string;
  readonly promise: string;
  readonly createdChapter: number;
  readonly relatedCharacters: ReadonlyArray<string>;
  readonly buildUpEvents: ReadonlyArray<PayoffBuildUp>;
  readonly targetWindow: { readonly from: number; readonly to: number };
  readonly payoffRequirements: ReadonlyArray<string>;
  readonly witnessRequirements: ReadonlyArray<string>;
  readonly practicalRewardRequirements: ReadonlyArray<string>;
  readonly consequenceRequirements: ReadonlyArray<string>;
  readonly status: PayoffStatus;
  readonly sourceCommitIds: ReadonlyArray<string>;
}

export class PayoffLedgerStore {
  readonly path: string;

  constructor(bookDir: string) {
    this.path = join(bookDir, "story", "state", "payoff-ledger.json");
  }

  async load(): Promise<ReadonlyArray<PayoffEntry>> {
    const raw = await readFile(this.path, "utf-8").catch(() => "[]");
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value as PayoffEntry[] : [];
  }

  async projectCommit(commit: ChapterCommit): Promise<{ readonly changed: number; readonly total: number }> {
    const current = new Map((await this.load()).map((entry) => [entry.id, entry]));
    let changed = 0;
    for (const event of commit.events) {
      const action = payoffStatus(event);
      if (!action) continue;
      const existing = current.get(event.subject);
      const next = updatePayoffEntry(existing, commit, event, action);
      current.set(next.id, next);
      changed += 1;
    }
    const values = [...current.values()].sort((left, right) =>
      left.createdChapter - right.createdChapter || left.id.localeCompare(right.id));
    await writeJsonAtomic(this.path, values);
    return { changed, total: values.length };
  }

  async dueAt(chapter: number): Promise<ReadonlyArray<PayoffEntry>> {
    return (await this.load()).filter((entry) =>
      !["paid_off", "abandoned"].includes(entry.status)
      && entry.targetWindow.from <= chapter);
  }
}

export function auditPayoff(params: {
  readonly content: string;
  readonly chapter: number;
  readonly targets: ReadonlyArray<PayoffEntry>;
}): PayoffAudit {
  const issues: PayoffAuditIssue[] = [];
  for (const target of params.targets) {
    const promiseMentioned = terms(target.promise).some((term) => params.content.includes(term));
    const hasAction = /选择|决定|夺|拿|赢|击败|揭开|证明|救|拒绝|反击|交出|公开|完成/.test(params.content);
    const hasRealityResult = /获得(?:身份|资源|权力|职位|奖励|资格|选择权)|失去(?:身份|资源|权力|资格)|成为|归属(?:改变|确定)|身份(?:被确认|改变|生效)|关系(?:改变|破裂|确认)|认知(?:改变|推翻)|造成[^。！？]{0,20}后果/.test(params.content);
    const onlyShock = /震惊|目瞪口呆|倒吸一口凉气|不敢相信/.test(params.content)
      && !hasRealityResult;
    if (params.chapter > target.targetWindow.to && !promiseMentioned) {
      issues.push({
        id: `payoff-overdue-${target.id}`,
        promiseId: target.id,
        severity: "blocking",
        message: `读者承诺已超过兑现窗口：${target.promise}`,
        suggestion: "本章必须推进或兑现该承诺，若需延期必须产生新的代价和明确窗口。",
      });
    } else if (promiseMentioned && (!hasAction || !hasRealityResult || onlyShock)) {
      issues.push({
        id: `payoff-false-${target.id}`,
        promiseId: target.id,
        severity: "advisory",
        message: `承诺被提及但缺少主角行动或现实结果：${target.promise}`,
        suggestion: "补足主动选择、权威/现实确认、实际收益与后续影响，不能只写围观震惊。",
      });
    }
  }
  return {
    passed: !issues.some((issue) => issue.severity === "blocking"),
    score: Math.max(0, 100 - issues.filter((issue) => issue.severity === "blocking").length * 25
      - issues.filter((issue) => issue.severity === "advisory").length * 8),
    issues,
    auditedPromiseIds: params.targets.map((target) => target.id),
    verdict: issues.some((issue) => issue.severity === "blocking")
      ? "block"
      : issues.length > 0 ? "revise" : "pass",
  };
}

export interface PayoffAuditIssue {
  readonly id: string;
  readonly promiseId: string;
  readonly severity: "advisory" | "blocking";
  readonly message: string;
  readonly suggestion: string;
}

export interface PayoffAudit {
  readonly passed: boolean;
  readonly score: number;
  readonly issues: ReadonlyArray<PayoffAuditIssue>;
  readonly auditedPromiseIds: ReadonlyArray<string>;
  readonly verdict: "pass" | "revise" | "block";
}

export async function savePayoffAudit(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly audit: PayoffAudit;
}): Promise<string> {
  const path = join(
    params.bookDir,
    "quality",
    "payoff",
    `chapter-${String(params.chapter).padStart(4, "0")}.json`,
  );
  await writeJsonAtomic(path, {
    ...params.audit,
    chapter: params.chapter,
    createdAt: new Date().toISOString(),
  });
  return path;
}

function updatePayoffEntry(
  existing: PayoffEntry | undefined,
  commit: ChapterCommit,
  event: StoryEvent,
  action: PayoffStatus,
): PayoffEntry {
  const payload = event.payload;
  const defaultWindow = { from: commit.chapter + 1, to: commit.chapter + 8 };
  const targetWindow = {
    from: numberValue(payload.targetFrom, existing?.targetWindow.from ?? defaultWindow.from),
    to: numberValue(payload.targetTo, existing?.targetWindow.to ?? defaultWindow.to),
  };
  return {
    id: event.subject,
    bookId: commit.bookId,
    type: String(payload.type ?? existing?.type ?? "reader-promise"),
    promise: String(payload.promise ?? payload.content ?? existing?.promise ?? event.subject),
    createdChapter: existing?.createdChapter ?? commit.chapter,
    relatedCharacters: unique([
      ...(existing?.relatedCharacters ?? []),
      ...stringArray(payload.relatedCharacters),
      ...(event.object ? [event.object] : []),
    ]),
    buildUpEvents: uniqueByEventId([
      ...(existing?.buildUpEvents ?? []),
      {
        chapter: commit.chapter,
        eventId: event.eventId,
        action,
        evidence: event.evidence.length > 0 ? event.evidence : [event.sourceExcerpt],
      },
    ]),
    targetWindow,
    payoffRequirements: stringArray(payload.payoffRequirements ?? existing?.payoffRequirements),
    witnessRequirements: stringArray(payload.witnessRequirements ?? existing?.witnessRequirements),
    practicalRewardRequirements: stringArray(payload.practicalRewardRequirements ?? existing?.practicalRewardRequirements),
    consequenceRequirements: stringArray(payload.consequenceRequirements ?? existing?.consequenceRequirements),
    status: action,
    sourceCommitIds: unique([...(existing?.sourceCommitIds ?? []), commit.commitId]),
  };
}

function payoffStatus(event: StoryEvent): PayoffStatus | null {
  const mapping: Readonly<Record<string, PayoffStatus>> = {
    reader_promise_created: "created",
    reader_promise_advanced: "reinforced",
    reader_promise_delayed: "delayed",
    reader_promise_threatened: "threatened",
    reader_promise_partially_paid: "partially_paid",
    reader_promise_paid_off: "paid_off",
    reader_promise_transformed: "transformed",
    reader_promise_abandoned: "abandoned",
  };
  return mapping[event.eventType] ?? null;
}

function terms(value: string): string[] {
  return value.split(/[，。；、：:,.!！?？\s]+/).filter((term) => term.length >= 2);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function uniqueByEventId(values: ReadonlyArray<PayoffBuildUp>): PayoffBuildUp[] {
  return [...new Map(values.map((value) => [value.eventId, value])).values()];
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

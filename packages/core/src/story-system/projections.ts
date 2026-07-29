import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MemoryDB } from "../state/memory-db.js";
import type { StoredHook } from "../state/memory-db.js";
import { saveRuntimeStateSnapshot } from "../state/runtime-state-store.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import { ChapterCommitStore } from "./commit.js";
import { saveChapterAmendment, type ChapterAmendmentReason } from "./amendments.js";
import { ChapterCommitSchema } from "./schemas.js";
import { completeProjectionTransactions } from "./transaction.js";
import type {
  ChapterCommit,
  ChapterCommitProjectionPayload,
  StoryProjectionResult,
} from "./types.js";
import {
  DynamicPlotStateStore,
  EventCausalGraphStore,
  TemporalKnowledgeGraphStore,
  listFutureSpecIds,
  proposeOutlineRevisionFromCommit,
} from "../narrative-research/index.js";
import { PayoffLedgerStore } from "../story-craft/index.js";

export type StoryProjector = (commit: ChapterCommit) => Promise<Record<string, unknown> | void>;

export class ProjectionManager {
  private readonly projectors = new Map<string, { required: boolean; run: StoryProjector }>();

  constructor(readonly bookDir: string) {}

  register(name: string, run: StoryProjector, required = true): this {
    this.projectors.set(name, { run, required });
    return this;
  }

  async project(commit: ChapterCommit, only?: ReadonlySet<string>): Promise<ReadonlyArray<StoryProjectionResult>> {
    const results: StoryProjectionResult[] = [];
    for (const [name, projector] of this.projectors) {
      if (only && !only.has(name)) {
        results.push({ name, status: "skipped", durationMs: 0 });
        continue;
      }
      const startedAt = Date.now();
      try {
        const details = await projector.run(commit);
        results.push({ name, status: "done", durationMs: Date.now() - startedAt, details: details ?? undefined });
      } catch (error) {
        results.push({
          name,
          status: projector.required ? "failed" : "skipped",
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await appendProjectionLog(this.bookDir, commit, results);
    return results;
  }
}

export function createDefaultProjectionManager(
  bookDir: string,
  options: {
    readonly afterLegacyProjection?: (commit: ChapterCommit) => Promise<void>;
    readonly sequenceSize?: number;
    readonly generateSequenceSummaries?: boolean;
    readonly generateArcSummaries?: boolean;
  } = {},
): ProjectionManager {
  const manager = new ProjectionManager(bookDir);
  manager
    .register("amendmentAudit", (commit) => projectAmendmentAudit(bookDir, commit))
    .register("currentState", (commit) => writeMarkdownProjections(bookDir, commit))
    .register("temporalMemory", (commit) => projectTemporalMemory(bookDir, commit))
    .register("chapterSummary", (commit) => projectSummary(bookDir, commit))
    .register("hierarchicalSummary", (commit) => projectHierarchicalSummaries(
      bookDir,
      commit,
      options.sequenceSize ?? 8,
      options.generateSequenceSummaries ?? true,
      options.generateArcSummaries ?? true,
    ))
    .register("hooks", (commit) => projectHooks(bookDir, commit))
    .register("entity", (commit) => projectEntityIndex(bookDir, commit))
    .register("relationship", (commit) => projectRelationshipIndex(bookDir, commit))
    .register("causalGraph", (commit) => new EventCausalGraphStore(bookDir).projectCommit(commit))
    .register("temporalGraph", (commit) => new TemporalKnowledgeGraphStore(bookDir).projectCommit(commit))
    .register("dynamicPlotState", (commit) => projectDynamicPlotState(bookDir, commit))
    .register("payoffLedger", (commit) => new PayoffLedgerStore(bookDir).projectCommit(commit))
    .register("dynamicOutline", (commit) => projectDynamicOutline(bookDir, commit), false)
    .register("retrievalIndex", (commit) => projectRetrievalIndex(bookDir, commit));
  if (options.afterLegacyProjection) manager.register("legacyCompatibility", options.afterLegacyProjection, false);
  return manager;
}

async function projectDynamicPlotState(
  bookDir: string,
  commit: ChapterCommit,
): Promise<Record<string, unknown>> {
  const state = await new DynamicPlotStateStore(bookDir).projectCommit(commit);
  return {
    goals: state.currentGoals.length,
    conflicts: state.activeConflicts.length,
    decisions: state.unresolvedDecisions.length,
    expectations: state.activeReaderExpectations.length,
  };
}

async function projectDynamicOutline(
  bookDir: string,
  commit: ChapterCommit,
): Promise<Record<string, unknown>> {
  const futureSpecIds = await listFutureSpecIds(bookDir, commit.chapter);
  const revision = await proposeOutlineRevisionFromCommit({ bookDir, commit, futureSpecIds });
  return revision
    ? { revisionId: revision.id, affectedSpecIds: revision.affectedSpecIds }
    : { proposed: false };
}

async function projectAmendmentAudit(
  bookDir: string,
  commit: ChapterCommit,
): Promise<Record<string, unknown>> {
  const originalCommitId = typeof commit.provenance.amendsCommitId === "string"
    ? commit.provenance.amendsCommitId
    : null;
  if (!originalCommitId) return { skipped: true };
  const reason = isAmendmentReason(commit.provenance.amendmentReason)
    ? commit.provenance.amendmentReason
    : "fact-correction";
  const revokedEventIds = Array.isArray(commit.provenance.revokedEventIds)
    ? commit.provenance.revokedEventIds.filter((value): value is string => typeof value === "string")
    : [];
  const previousContentHash = typeof commit.provenance.previousContentHash === "string"
    ? commit.provenance.previousContentHash
    : "";
  if (!/^[a-f0-9]{64}$/i.test(previousContentHash)) {
    throw new Error(`Amendment ${commit.commitId} is missing a valid previousContentHash`);
  }
  const result = await saveChapterAmendment({
    bookDir,
    bookId: commit.bookId,
    chapter: commit.chapter,
    originalCommitId,
    previousContentHash,
    nextContentHash: commit.source.contentHash,
    reason,
    revokedEventIds,
    addedEvents: commit.events,
    stateCorrections: commit.stateDeltas,
    createdAt: commit.createdAt,
  });
  return { amendmentId: result.amendmentId, path: result.path };
}

function isAmendmentReason(value: unknown): value is ChapterAmendmentReason {
  return value === "retcon"
    || value === "fact-correction"
    || value === "entity-merge"
    || value === "entity-split"
    || value === "hook-reclassification"
    || value === "manual-author-override";
}

async function projectHierarchicalSummaries(
  bookDir: string,
  commit: ChapterCommit,
  sequenceSize: number,
  generateSequenceSummaries: boolean,
  generateArcSummaries: boolean,
): Promise<Record<string, unknown>> {
  const commits = (await new ChapterCommitStore(bookDir).listCommits())
    .filter((candidate) => candidate.status === "accepted");
  const effective = new Map<number, ChapterCommit>();
  for (const candidate of commits) effective.set(candidate.chapter, candidate);
  const summaries = [...effective.values()]
    .filter((candidate) => candidate.chapter <= Number(commit.provenance.canonicalHeadChapter ?? commit.chapter))
    .sort((left, right) => left.chapter - right.chapter);
  if (summaries.length === 0) return { files: 0 };
  const summaryDir = join(bookDir, "story", "summaries");
  const currentChapter = summaries.at(-1)!.chapter;
  const sequenceStart = Math.floor((currentChapter - 1) / sequenceSize) * sequenceSize + 1;
  const sequenceEnd = Math.min(currentChapter, sequenceStart + sequenceSize - 1);
  const sequence = summaries.filter((candidate) =>
    candidate.chapter >= sequenceStart && candidate.chapter <= sequenceEnd);
  const arcStart = Math.floor((currentChapter - 1) / 40) * 40 + 1;
  const volumeStart = Math.floor((currentChapter - 1) / 100) * 100 + 1;
  const arc = summaries.filter((candidate) => candidate.chapter >= arcStart);
  const volume = summaries.filter((candidate) => candidate.chapter >= volumeStart);
  const records = [
    ...(generateSequenceSummaries ? [{
      path: join(summaryDir, `sequence-${String(sequenceStart).padStart(4, "0")}-${String(sequenceEnd).padStart(4, "0")}.md`),
      title: `Sequence Summary ${sequenceStart}-${sequenceEnd}`,
      rows: sequence,
      kind: "sequence",
    }] : []),
    ...(generateArcSummaries
      ? [{ path: join(summaryDir, "arc-summary.md"), title: `Arc Summary ${arcStart}-${currentChapter}`, rows: arc, kind: "arc" }]
      : []),
    { path: join(summaryDir, "volume-summary.md"), title: `Volume Summary ${volumeStart}-${currentChapter}`, rows: volume, kind: "volume" },
    { path: join(summaryDir, "book-summary.md"), title: `Book Summary 1-${currentChapter}`, rows: summaries, kind: "book" },
  ];
  for (const record of records) {
    const body = [
      `# ${record.title}`,
      "",
      `- kind: ${record.kind}`,
      `- sourceRange: ${record.rows[0]?.chapter ?? 1}-${record.rows.at(-1)?.chapter ?? currentChapter}`,
      `- generationVersion: inoks-story-hierarchical-summary/v1`,
      "- authority: compressed-view-only",
      "",
      ...record.rows.map((candidate) =>
        `## Chapter ${candidate.chapter}: ${candidate.summary.title}\n\n${[
          candidate.summary.events,
          candidate.summary.stateChanges,
          candidate.summary.hookActivity,
        ].filter(Boolean).join("\n") || candidate.summary.text}`),
    ].join("\n");
    await writeAtomic(record.path, body);
  }
  return { files: records.length, sourceChapter: currentChapter };
}

export async function replayStorySystem(params: {
  readonly bookDir: string;
  readonly fromChapter?: number;
  readonly toChapter?: number;
  readonly resetDerived?: boolean;
}): Promise<ReadonlyArray<StoryProjectionResult>> {
  const store = new ChapterCommitStore(params.bookDir);
  const commits = (await store.listCommits()).filter((commit) =>
    commit.status === "accepted"
    && commit.chapter >= (params.fromChapter ?? 1)
    && commit.chapter <= (params.toChapter ?? Number.MAX_SAFE_INTEGER));
  if (params.resetDerived && (params.fromChapter ?? 1) === 1) await resetDerivedData(params.bookDir);
  const manager = createDefaultProjectionManager(params.bookDir);
  const results: StoryProjectionResult[] = [];
  for (const commit of commits) results.push(...await manager.project(commit));
  return results;
}

export async function repairStorySystem(bookDir: string): Promise<{
  readonly results: ReadonlyArray<StoryProjectionResult>;
  readonly completedTransactions: ReadonlyArray<string>;
}> {
  const results = await replayStorySystem({ bookDir, fromChapter: 1 });
  const failures = results.filter((result) => result.status === "failed");
  if (failures.length > 0) {
    return { results, completedTransactions: [] };
  }
  const commits = await new ChapterCommitStore(bookDir).listCommits();
  const completedTransactions = await completeProjectionTransactions(
    bookDir,
    new Set(commits.filter((commit) => commit.status === "accepted").map((commit) => commit.commitId)),
  );
  return { results, completedTransactions };
}

async function writeMarkdownProjections(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const payload = projectionPayload(commit);
  const storyDir = join(bookDir, "story");
  const writes: Array<Promise<void>> = [];
  const mapping: Array<[keyof ChapterCommitProjectionPayload, string]> = [
    ["currentStateMarkdown", "current_state.md"],
    ["ledgerMarkdown", "particle_ledger.md"],
    ["hooksMarkdown", "pending_hooks.md"],
    ["chapterSummariesMarkdown", "chapter_summaries.md"],
    ["subplotsMarkdown", "subplot_board.md"],
    ["emotionalArcsMarkdown", "emotional_arcs.md"],
    ["characterMatrixMarkdown", "character_matrix.md"],
  ];
  for (const [key, fileName] of mapping) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      const content = key === "chapterSummariesMarkdown"
        ? normalizeChapterSummariesDocument(value, commit.provenance.language === "en" ? "en" : "zh")
        : value;
      writes.push(writeAtomic(join(storyDir, fileName), content));
    }
  }
  await Promise.all(writes);
  if (payload.runtimeStateSnapshot) {
    await saveRuntimeStateSnapshot(bookDir, payload.runtimeStateSnapshot as Parameters<typeof saveRuntimeStateSnapshot>[1]);
  } else {
    await rewriteStructuredStateFromMarkdown({
      bookDir,
      fallbackChapter: commit.chapter,
    });
  }
  return { files: writes.length };
}

export function normalizeChapterSummariesDocument(
  value: string,
  language: "zh" | "en",
): string {
  const trimmed = value.trim();
  if (/^#\s+/m.test(trimmed)) return `${trimmed}\n`;
  const header = language === "en"
    ? [
        "# Chapter Summaries",
        "",
        "| Chapter | Title | Characters | Key Events | State Changes | Hook Activity | Mood | Chapter Type |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ]
    : [
        "# 章节摘要",
        "",
        "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ];
  return `${[...header, trimmed].join("\n")}\n`;
}

async function projectTemporalMemory(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const projected = await withMemoryDbRetry(bookDir, (db) => {
    db.applyCommit(commit);
    return { facts: commit.stateDeltas.length, events: commit.events.length };
  });
  return projected.available ? projected.value : sqliteFallbackDetails();
}

async function projectSummary(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const summary = commit.summary;
  const projected = await withMemoryDbRetry(bookDir, (db) => {
      db.upsertSummary({
        chapter: summary.chapter,
        title: summary.title,
        characters: summary.characters,
        events: summary.events,
        stateChanges: summary.stateChanges,
        hookActivity: summary.hookActivity,
        mood: summary.mood,
        chapterType: summary.chapterType,
      });
  });
  const path = join(bookDir, "story", "summaries", `chapter-${String(commit.chapter).padStart(4, "0")}.md`);
  await writeAtomic(path, `# 第${commit.chapter}章 ${summary.title}\n\n${summary.text || summary.events}\n`);
  return projected.available ? { path } : { path, ...sqliteFallbackDetails() };
}

async function projectHooks(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const projected = await withMemoryDbRetry(bookDir, (db) => {
    let changed = 0;
    for (const event of commit.events) {
      if (!event.eventType.startsWith("open_loop_")) continue;
      const existing = db.getHook(event.subject);
      const payload = event.payload;
      const status = event.eventType === "open_loop_closed" ? "closed"
        : event.eventType === "open_loop_advanced" ? "progressing"
          : String(payload.status ?? "open");
      const hook: StoredHook = {
        hookId: event.subject,
        startChapter: existing?.startChapter ?? Number(payload.startChapter ?? commit.chapter),
        type: String(payload.type ?? existing?.type ?? "open-loop"),
        status,
        lastAdvancedChapter: commit.chapter,
        expectedPayoff: String(payload.expectedPayoff ?? existing?.expectedPayoff ?? ""),
        payoffTiming: typeof payload.payoffTiming === "string" ? payload.payoffTiming : existing?.payoffTiming,
        notes: String(payload.notes ?? existing?.notes ?? ""),
        content: String(payload.content ?? existing?.content ?? payload.expectedPayoff ?? ""),
        targetChapter: typeof payload.targetChapter === "number" ? payload.targetChapter : existing?.targetChapter,
        targetArc: String(payload.targetArc ?? existing?.targetArc ?? ""),
        urgency: String(payload.urgency ?? existing?.urgency ?? ""),
        dependsOn: Array.isArray(payload.dependsOn) ? payload.dependsOn.map(String) : existing?.dependsOn,
        relatedCharacters: Array.isArray(payload.relatedCharacters)
          ? payload.relatedCharacters.map(String)
          : existing?.relatedCharacters,
        evidence: [...new Set([...(existing?.evidence ?? []), ...event.evidence])],
        closeReason: event.eventType === "open_loop_closed"
          ? String(payload.closeReason ?? payload.reason ?? existing?.closeReason ?? "")
          : existing?.closeReason,
      };
      db.upsertHook(hook);
      changed += 1;
    }
    return { changed };
  });
  return projected.available ? projected.value : sqliteFallbackDetails();
}

async function projectEntityIndex(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const path = join(bookDir, "story", "state", "entities.json");
  const current = await readJsonArray(path);
  const byId = new Map(current.map((item) => [String(item.entityId ?? ""), item]));
  for (const delta of commit.entityDeltas) byId.set(delta.entityId, { ...delta, sourceCommitId: commit.commitId });
  await writeJsonAtomic(path, [...byId.values()]);
  return { count: byId.size };
}

async function projectRelationshipIndex(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const path = join(bookDir, "story", "state", "relationships.json");
  const current = await readJsonArray(path);
  const byId = new Map(current.map((item) => [`${item.fromEntity}::${item.toEntity}::${item.relationshipType}`, item]));
  for (const delta of commit.relationshipDeltas) {
    const key = `${delta.fromEntity}::${delta.toEntity}::${delta.relationshipType}`;
    byId.set(key, { ...delta, sourceCommitId: commit.commitId, sourceChapter: commit.chapter });
  }
  await writeJsonAtomic(path, [...byId.values()]);
  return { count: byId.size };
}

async function projectRetrievalIndex(bookDir: string, commit: ChapterCommit): Promise<Record<string, unknown>> {
  const projected = await withMemoryDbRetry(bookDir, (db) => {
    db.indexStoryEvents(commit.events.map((event) => ({
      ...event,
      sourceCommitId: commit.commitId,
    })));
    return { events: commit.events.length };
  });
  return projected.available ? projected.value : sqliteFallbackDetails();
}

async function withMemoryDbRetry<T>(
  bookDir: string,
  operation: (db: MemoryDB) => T,
): Promise<{ readonly available: true; readonly value: T } | { readonly available: false }> {
  const retryDelaysMs = [0, 25, 75] as const;
  let lastError: unknown;
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    let db: MemoryDB | undefined;
    try {
      db = new MemoryDB(bookDir);
      return { available: true, value: operation(db) };
    } catch (error) {
      lastError = error;
      const retryableUnavailable = isNodeSqliteUnavailable(error);
      const retryableBusy = isSqliteBusy(error);
      if (!retryableUnavailable && !retryableBusy) throw error;
      if (attempt === retryDelaysMs.length - 1) {
        if (retryableUnavailable) return { available: false };
        throw error;
      }
      const delay = retryableBusy ? retryDelaysMs[attempt + 1] : 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      db?.close();
    }
  }
  if (isNodeSqliteUnavailable(lastError)) return { available: false };
  throw lastError;
}

function isNodeSqliteUnavailable(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  return code === "ERR_UNKNOWN_BUILTIN_MODULE"
    || /^No such built-in module:\s*node:sqlite$/i.test(message)
    || /^Cannot find module ['"]node:sqlite['"]/i.test(message);
}

function isSqliteBusy(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  return code === "SQLITE_BUSY"
    || code === "SQLITE_LOCKED"
    || /\bSQLITE_BUSY\b/i.test(message)
    || /\bSQLITE_LOCKED\b/i.test(message)
    || /database is (?:locked|busy)/i.test(message);
}

function sqliteFallbackDetails(): Record<string, unknown> {
  return {
    degraded: true,
    reason: "sqlite-runtime-unavailable",
    fallback: "commit-and-markdown",
  };
}

async function appendProjectionLog(
  bookDir: string,
  commit: ChapterCommit,
  results: ReadonlyArray<StoryProjectionResult>,
): Promise<void> {
  const store = new ChapterCommitStore(bookDir);
  const path = join(store.root, "projection-log.jsonl");
  await mkdir(dirname(path), { recursive: true });
  const record = {
    runId: `${commit.commitId}:${Date.now()}`,
    commitId: commit.commitId,
    commitHash: commit.commitHash,
    chapter: commit.chapter,
    createdAt: new Date().toISOString(),
    status: results.some((result) => result.status === "failed") ? "failed" : "done",
    projectors: results,
  };
  await writeFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf-8", flag: "a" });
}

function projectionPayload(commit: ChapterCommit): ChapterCommitProjectionPayload {
  const value = commit.provenance.projectionPayload;
  if (!value || typeof value !== "object") return {};
  return value as ChapterCommitProjectionPayload;
}

async function resetDerivedData(bookDir: string): Promise<void> {
  const storyDir = join(bookDir, "story");
  const targets = [
    join(storyDir, "current_state.md"),
    join(storyDir, "particle_ledger.md"),
    join(storyDir, "pending_hooks.md"),
    join(storyDir, "chapter_summaries.md"),
    join(storyDir, "subplot_board.md"),
    join(storyDir, "emotional_arcs.md"),
    join(storyDir, "character_matrix.md"),
    join(storyDir, "volume_summaries.md"),
    join(storyDir, "memory.db"),
    join(storyDir, "memory.db-shm"),
    join(storyDir, "memory.db-wal"),
    join(storyDir, "state"),
    join(storyDir, "summaries"),
  ];
  for (const target of targets) await rm(target, { recursive: true, force: true });
}

async function readJsonArray(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path, "utf-8").catch(() => "[]");
  const value = JSON.parse(raw);
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, value, "utf-8");
  await rename(temp, path);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, JSON.stringify(value, null, 2));
}

export async function latestProjectionFailures(bookDir: string): Promise<ReadonlyArray<string>> {
  const store = new ChapterCommitStore(bookDir);
  const path = join(store.root, "projection-log.jsonl");
  const lines = (await readFile(path, "utf-8").catch(() => "")).trim().split(/\r?\n/).filter(Boolean);
  const latestByChapter = new Map<number, { projectors?: StoryProjectionResult[] }>();
  for (const line of lines) {
    const record = JSON.parse(line) as { chapter: number; projectors?: StoryProjectionResult[] };
    latestByChapter.set(record.chapter, record);
  }
  return [...latestByChapter.values()].flatMap((record) =>
    (record.projectors ?? []).filter((result) => result.status === "failed").map((result) => `${result.name}: ${result.error ?? "failed"}`));
}

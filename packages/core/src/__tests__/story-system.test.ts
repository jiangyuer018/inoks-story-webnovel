import { access, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChapterCommitStore,
  ChapterApprovalStore,
  ProjectionManager,
  approveChapterCommit,
  buildChapterCommit,
  canonicalJson,
  commitChapterTransaction,
  deterministicCommitId,
  deterministicEventId,
  latestProjectionFailures,
  markTransactionPhase,
  migrateLegacyStorySystem,
  recoverChapterTransactions,
  replayStorySystem,
  runStorySystemPreflight,
  sha256,
  validateChapterCommit,
  type ChapterCommit,
  type StateDelta,
} from "../story-system/index.js";
import { MemoryDB } from "../state/memory-db.js";

const tempDirs: string[] = [];
const cleanCandidates = {
  acceptedCandidates: [],
  ambiguousCandidates: [],
  rejectedCandidates: [],
} as const;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ChapterCommit", () => {
  it("uses deterministic commit and event ids", () => {
    const input = { bookId: "book", chapter: 1, contentHash: sha256("正文"), parentCommitId: null };
    expect(deterministicCommitId(input)).toBe(deterministicCommitId(input));
    const event = { commitId: "commit-1", eventType: "location_changed", subject: "林岚", payload: { to: "北站" } };
    expect(deterministicEventId(event)).toBe(deterministicEventId(event));
    expect(deterministicEventId(event)).toBe(deterministicEventId({
      ...event,
      payload: { to: "北站" },
    }));
  });

  it("fails closed when required extended validation is omitted", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root, { extendedValidation: {} });
    expect(commit.status).toBe("rejected");
    expect(commit.validation.storyConvergencePassed).toBe(false);
    expect(commit.validation.humanFeelPassed).toBe(false);
    expect(commit.validation.temporalPassed).toBe(false);
    expect(commit.validation.humanApprovalPassed).toBe(false);
  });

  it("reads hash-valid legacy commits without weakening strict validation for new commits", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root);
    await commitChapterTransaction({
      bookDir: root,
      commit,
      chapterDocument: "# 第1章 账本\n\n正文",
    });
    const store = new ChapterCommitStore(root);
    const path = store.commitPath(1);
    const legacy = JSON.parse(await readFile(path, "utf-8")) as Record<string, any>;
    for (const key of [
      "storyConvergencePassed",
      "humanFeelPassed",
      "emotionPassed",
      "payoffPassed",
      "structurePassed",
      "similarityPassed",
      "temporalPassed",
      "humanApprovalPassed",
    ]) delete legacy.validation[key];
    const { commitHash: _oldHash, ...withoutHash } = legacy;
    legacy.commitHash = sha256(canonicalJson(withoutHash));
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, "utf-8");

    const [loaded] = await store.listCommits();
    expect(loaded?.validation.humanApprovalPassed).toBe(true);
    await expect(store.verifyChain()).resolves.toBeUndefined();

    expect(buildCommit(root, { extendedValidation: {} }).status).toBe("rejected");
  });

  it("stores a reviewed draft outside chapters and approves only the same hash", async () => {
    const root = await makeBookDir();
    const draft = buildCommit(root, {
      content: "林岚把账本推到桌中央。",
      extendedValidation: {
        ...allExtendedGatesPassed(),
        humanApprovalPassed: false,
      },
    });
    expect(draft.status).toBe("rejected");
    const store = new ChapterApprovalStore(root);
    const saved = await store.save({
      content: "林岚把账本推到桌中央。",
      record: {
        bookId: "book",
        chapter: 1,
        title: "账本",
        lifecycleStatus: "awaiting-human-approval",
        reviewedContentHash: draft.source.contentHash,
        commitDraft: draft,
        auditResult: { passed: true, issues: [], summary: "pass" },
        finalWordCount: 12,
        lengthWarnings: [],
        degradedIssues: [],
      },
    });
    await expect(access(join(root, "chapters", "0001_账本.md"))).rejects.toThrow();
    expect(saved.record.contentHash).toBe(draft.source.contentHash);
    expect(() => approveChapterCommit({
      commit: draft,
      approvedContentHash: sha256("已被修改"),
    })).toThrow(/hash/i);

    const marked = await store.markApproved(1, saved.record.contentHash);
    const accepted = approveChapterCommit({
      commit: marked.record.commitDraft,
      approvedContentHash: marked.record.approvedContentHash!,
      approvedAt: marked.record.approvedAt,
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.validation.humanApprovalPassed).toBe(true);
  });

  it("rejects ambiguity and parent/content conflicts", async () => {
    const root = await makeBookDir();
    const ambiguous = buildCommit(root, {
      candidates: {
        acceptedCandidates: [],
        rejectedCandidates: [],
        ambiguousCandidates: [{
          eventId: "pending",
          chapter: 1,
          eventType: "entity_state_changed",
          subject: "林岚",
          payload: {},
          evidence: [],
          confidence: 0.5,
          epistemicStatus: "rumor",
          sourceExcerpt: "听说她受伤了",
          sourceStart: 0,
          sourceEnd: 7,
        }],
      },
    });
    expect(ambiguous.status).toBe("rejected");
    const accepted = buildCommit(root);
    expect(() => validateChapterCommit({ commit: accepted, content: "别的正文", head: null })).toThrow("content hash");
    expect(() => validateChapterCommit({ commit: accepted, content: "正文", head: accepted })).toThrow("parent conflict");
  });

  it("rejects a state delta whose old value does not match canonical history", async () => {
    const root = await makeBookDir();
    const first = buildCommit(root, {
      stateDeltas: [{ subject: "林岚", predicate: "location", oldValue: null, newValue: "北站" }],
    });
    await commitChapterTransaction({ bookDir: root, commit: first, chapterDocument: "# 第1章 账本\n\n正文" });
    const conflict = buildCommit(root, {
      chapter: 2,
      content: "第二章",
      parentCommit: first,
      stateDeltas: [{ subject: "林岚", predicate: "location", oldValue: "南站", newValue: "仓库" }],
    });
    await expect(commitChapterTransaction({
      bookDir: root,
      commit: conflict,
      chapterDocument: "# 第2章 门外\n\n第二章",
    })).rejects.toThrow("State old-value conflict");
    expect((await new ChapterCommitStore(root).loadHead())?.commitId).toBe(first.commitId);
  });

  it("commits idempotently, verifies the hash chain, and preserves source snapshots", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root);
    const document = "# 第1章 账本\n\n正文";
    const first = await commitChapterTransaction({ bookDir: root, commit, chapterDocument: document });
    const second = await commitChapterTransaction({ bookDir: root, commit, chapterDocument: document });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    const store = new ChapterCommitStore(root);
    await expect(store.verifyChain()).resolves.toBeUndefined();
    expect(await readFile(store.sourcePath(commit.commitId), "utf-8")).toBe(document);
  });

  it("adds an old-chapter prose amendment to the same chain without changing canonical head chapter", async () => {
    const root = await makeBookDir();
    const first = buildCommit(root);
    await commitChapterTransaction({ bookDir: root, commit: first, chapterDocument: "# 第1章 账本\n\n正文" });
    const second = buildCommit(root, { chapter: 2, content: "第二章", parentCommit: first });
    await commitChapterTransaction({ bookDir: root, commit: second, chapterDocument: "# 第2章 门外\n\n第二章" });
    const amendment = buildCommit(root, {
      chapter: 1,
      content: "修订正文",
      parentCommit: second,
      chapterPath: join(root, "chapters", "0001_账本.md"),
      provenance: {
        amendsCommitId: first.commitId,
        canonicalHeadChapter: 2,
        previousContentHash: first.source.contentHash,
      },
    });
    await commitChapterTransaction({ bookDir: root, commit: amendment, chapterDocument: "# 第1章 账本\n\n修订正文" });
    const store = new ChapterCommitStore(root);
    expect((await store.loadHead())?.commitId).toBe(amendment.commitId);
    expect((await store.loadChapter(1))?.source.contentHash).toBe(sha256("修订正文"));
    await expect(store.verifyChain()).resolves.toBeUndefined();
    await replayStorySystem({ bookDir: root, resetDerived: true });
    const amendmentFiles = await readdir(join(root, ".inoks-story-webnovel", "story-system", "amendments"));
    expect(amendmentFiles).toHaveLength(1);
    await expect(readFile(
      join(root, ".inoks-story-webnovel", "story-system", "amendments", amendmentFiles[0]!),
      "utf-8",
    )).resolves.toContain('"reason": "fact-correction"');
  });

  it("replays derived markdown from accepted commits", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root, {
      projectionPayload: {
        currentStateMarkdown: "# 当前状态\n\n| 字段 | 值 |\n| --- | --- |\n| 地点 | 北站 |",
        hooksMarkdown: "# 伏笔池\n",
        chapterSummariesMarkdown: "# 章节摘要\n",
      },
    });
    await commitChapterTransaction({ bookDir: root, commit, chapterDocument: "# 第1章 账本\n\n正文" });
    await replayStorySystem({ bookDir: root, resetDerived: true });
    expect(await readFile(join(root, "story", "current_state.md"), "utf-8")).toContain("北站");
    const preflight = await runStorySystemPreflight({
      bookDir: root,
      strict: true,
      blockOnProjectionFailure: false,
    });
    expect(preflight.errors).toEqual([]);
    await writeFile(join(root, "story", "current_state.md"), "# 手工篡改\n", "utf-8");
    const drifted = await runStorySystemPreflight({
      bookDir: root,
      strict: true,
      blockOnProjectionFailure: false,
    });
    expect(drifted.errors).toContain(
      "projection-drift: story/current_state.md differs from accepted ChapterCommit",
    );
    await replayStorySystem({ bookDir: root, resetDerived: true });
    const repaired = await runStorySystemPreflight({
      bookDir: root,
      strict: true,
      blockOnProjectionFailure: false,
    });
    expect(repaired.errors).toEqual([]);
  });

  it("recovers a crash after the chapter move and restores a complete commit boundary", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root);
    const transaction = await commitChapterTransaction({
      bookDir: root,
      commit,
      chapterDocument: "# 第1章 账本\n\n正文",
    });
    const manifest = JSON.parse(await readFile(transaction.manifestPath, "utf-8")) as Record<string, string>;
    await rename(manifest.commitPath!, manifest.stagedCommitPath!);
    await rename(manifest.eventPath!, manifest.stagedEventPath!);
    await rename(manifest.sourcePath!, manifest.stagedSourcePath!);
    await rm(join(root, ".inoks-story-webnovel", "story-system", "HEAD"), { force: true });
    await writeFile(transaction.manifestPath, `${JSON.stringify({ ...manifest, phase: "chapter_moved" }, null, 2)}\n`, "utf-8");

    await expect(recoverChapterTransactions(root)).resolves.toEqual([commit.commitId]);
    const store = new ChapterCommitStore(root);
    expect((await store.loadHead())?.commitId).toBe(commit.commitId);
    expect(await readFile(store.sourcePath(commit.commitId), "utf-8")).toContain("正文");
    await expect(store.verifyChain()).resolves.toBeUndefined();
  });

  it("rolls back an unrecoverable new-chapter transaction without leaving an orphan chapter", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root);
    const transaction = await commitChapterTransaction({
      bookDir: root,
      commit,
      chapterDocument: "# 第1章 账本\n\n正文",
    });
    const manifest = JSON.parse(await readFile(transaction.manifestPath, "utf-8")) as Record<string, string>;
    await Promise.all([
      rm(manifest.commitPath!, { force: true }),
      rm(manifest.eventPath!, { force: true }),
      rm(manifest.sourcePath!, { force: true }),
    ]);
    await writeFile(transaction.manifestPath, `${JSON.stringify({ ...manifest, phase: "chapter_moved" }, null, 2)}\n`, "utf-8");

    await expect(recoverChapterTransactions(root)).resolves.toEqual([]);
    await expect(readFile(transaction.chapterPath, "utf-8")).rejects.toThrow();
    expect(await new ChapterCommitStore(root).loadHead()).toBeNull();
  });

  it("restores the prior chapter and HEAD when an amendment transaction cannot be completed", async () => {
    const root = await makeBookDir();
    const first = buildCommit(root);
    const firstTransaction = await commitChapterTransaction({
      bookDir: root,
      commit: first,
      chapterDocument: "# 第1章 账本\n\n正文",
    });
    await markTransactionPhase(firstTransaction.manifestPath, "complete");
    const amendment = buildCommit(root, {
      content: "修订正文",
      parentCommit: first,
      provenance: {
        amendsCommitId: first.commitId,
        canonicalHeadChapter: 1,
      },
    });
    const transaction = await commitChapterTransaction({
      bookDir: root,
      commit: amendment,
      chapterDocument: "# 第1章 账本\n\n修订正文",
    });
    const manifest = JSON.parse(await readFile(transaction.manifestPath, "utf-8")) as Record<string, string>;
    await Promise.all([
      rm(manifest.commitPath!, { force: true }),
      rm(manifest.eventPath!, { force: true }),
      rm(manifest.sourcePath!, { force: true }),
    ]);
    await writeFile(transaction.manifestPath, `${JSON.stringify({ ...manifest, phase: "chapter_moved" }, null, 2)}\n`, "utf-8");

    await expect(recoverChapterTransactions(root)).resolves.toEqual([]);
    await expect(readFile(transaction.chapterPath, "utf-8")).resolves.toContain("\n正文");
    expect((await new ChapterCommitStore(root).loadHead())?.commitId).toBe(first.commitId);
  });

  it("keeps an accepted commit when one required projection fails and records it for preflight", async () => {
    const root = await makeBookDir();
    const commit = buildCommit(root);
    await commitChapterTransaction({ bookDir: root, commit, chapterDocument: "# 第1章 账本\n\n正文" });
    const manager = new ProjectionManager(root)
      .register("healthy", async () => ({ ok: true }))
      .register("broken", async () => {
        throw new Error("disk unavailable");
      });
    const results = await manager.project(commit);
    expect(results.find((result) => result.name === "broken")?.status).toBe("failed");
    expect((await new ChapterCommitStore(root).loadHead())?.commitId).toBe(commit.commitId);
    expect(await latestProjectionFailures(root)).toContain("broken: disk unavailable");
  });

  it("projects temporal fact history idempotently instead of deleting superseded facts", async () => {
    const root = await makeBookDir();
    const first = buildCommit(root, {
      stateDeltas: [{ subject: "林岚", predicate: "location", oldValue: null, newValue: "北站" }],
    });
    const second = buildCommit(root, {
      chapter: 2,
      content: "第二章",
      parentCommit: first,
      stateDeltas: [{ subject: "林岚", predicate: "location", oldValue: "北站", newValue: "仓库" }],
    });
    const db = new MemoryDB(root);
    try {
      db.applyCommit(first);
      db.applyCommit(second);
      db.applyCommit(second);
      expect(db.getFactsAt("林岚", 1).map((fact) => fact.object)).toEqual(["北站"]);
      expect(db.getFactsAt("林岚", 2).map((fact) => fact.object)).toEqual(["仓库"]);
      expect(db.getFactHistory("林岚")).toHaveLength(2);
      expect(db.getCurrentFacts()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("migrates legacy history only with --apply, preserves a backup, and resumes from HEAD", async () => {
    const root = await makeBookDir();
    const state = "# 当前状态\n\n| 字段 | 值 |\n| --- | --- |\n| 当前位置 | 北站 |\n";
    const hooks = "# 伏笔池\n";
    const summaries = [
      "# 章节摘要",
      "",
      "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | 账本 | 林岚 | 查账 | 到达北站 | 无 | 紧张 | investigation |",
      "",
    ].join("\n");
    await Promise.all([
      writeFile(join(root, "chapters", "0001_账本.md"), "# 第1章 账本\n\n正文", "utf-8"),
      writeFile(join(root, "story", "current_state.md"), state, "utf-8"),
      writeFile(join(root, "story", "pending_hooks.md"), hooks, "utf-8"),
      writeFile(join(root, "story", "chapter_summaries.md"), summaries, "utf-8"),
    ]);

    const dryRun = await migrateLegacyStorySystem({
      projectRoot: root,
      bookDir: root,
      bookId: "book",
    });
    expect(dryRun.applied).toBe(false);
    expect(await new ChapterCommitStore(root).loadHead()).toBeNull();
    const repeated = await migrateLegacyStorySystem({
      projectRoot: root,
      bookDir: root,
      bookId: "book",
    });
    expect(repeated.migrationId).toBe(dryRun.migrationId);

    const applied = await migrateLegacyStorySystem({
      projectRoot: root,
      bookDir: root,
      bookId: "book",
      apply: true,
    });
    expect(applied.applied).toBe(true);
    expect(applied.projectionDiffs.every((diff) => diff.matches)).toBe(true);
    await expect(access(join(applied.backupPath!, "chapters", "0001_账本.md"))).resolves.toBeUndefined();
    expect((await new ChapterCommitStore(root).loadHead())?.provenance.migrationId).toBe(applied.migrationId);

    await rm(applied.reportPath, { force: true });
    const resumed = await migrateLegacyStorySystem({
      projectRoot: root,
      bookDir: root,
      bookId: "book",
      apply: true,
    });
    expect(resumed.applied).toBe(true);
    expect(resumed.warnings[0]).toContain("Resumed");
  });
});

async function makeBookDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inoks-story-story-system-"));
  tempDirs.push(root);
  await mkdir(join(root, "chapters"), { recursive: true });
  await mkdir(join(root, "story"), { recursive: true });
  return root;
}

function buildCommit(
  root: string,
  overrides: {
    chapter?: number;
    content?: string;
    parentCommit?: ChapterCommit;
    chapterPath?: string;
    candidates?: Parameters<typeof buildChapterCommit>[0]["candidates"];
    projectionPayload?: Parameters<typeof buildChapterCommit>[0]["projectionPayload"];
    provenance?: Record<string, unknown>;
    stateDeltas?: ReadonlyArray<StateDelta>;
    extendedValidation?: Parameters<typeof buildChapterCommit>[0]["extendedValidation"];
  } = {},
): ChapterCommit {
  const chapter = overrides.chapter ?? 1;
  const content = overrides.content ?? "正文";
  return buildChapterCommit({
    bookId: "book",
    bookDir: root,
    chapter,
    title: chapter === 1 ? "账本" : "门外",
    content,
    wordCount: content.length,
    chapterPath: overrides.chapterPath ?? join(root, "chapters", `${String(chapter).padStart(4, "0")}_${chapter === 1 ? "账本" : "门外"}.md`),
    parentCommit: overrides.parentCommit,
    proseQualityPassed: true,
    continuityPassed: true,
    fulfillmentPassed: true,
    blockingCount: 0,
    extendedValidation: overrides.extendedValidation ?? allExtendedGatesPassed(),
    candidates: overrides.candidates ?? cleanCandidates,
    summary: {
      chapter,
      title: chapter === 1 ? "账本" : "门外",
      characters: "林岚",
      events: "查账",
      stateChanges: "",
      hookActivity: "",
      mood: "紧张",
      chapterType: "investigation",
      text: "林岚查账。",
    },
    projectionPayload: overrides.projectionPayload ?? {},
    provenance: overrides.provenance,
    stateDeltas: overrides.stateDeltas,
    createdAt: `2026-01-${String(chapter).padStart(2, "0")}T00:00:00.000Z`,
  });
}

function allExtendedGatesPassed() {
  return {
    storyConvergencePassed: true,
    humanFeelPassed: true,
    emotionPassed: true,
    payoffPassed: true,
    structurePassed: true,
    similarityPassed: true,
    temporalPassed: true,
    humanApprovalPassed: true,
  } as const;
}

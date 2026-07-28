import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createStateCard(params: {
  readonly chapter: number;
  readonly location: string;
  readonly protagonistState: string;
  readonly goal: string;
  readonly conflict: string;
}): string {
  return [
    "# Current State",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Current Chapter | ${params.chapter} |`,
    `| Current Location | ${params.location} |`,
    `| Protagonist State | ${params.protagonistState} |`,
    `| Current Goal | ${params.goal} |`,
    "| Current Constraint | The city gates are watched. |",
    "| Current Alliances | Mentor allies are scattered. |",
    `| Current Conflict | ${params.conflict} |`,
    "",
  ].join("\n");
}

interface FakeStore {
  facts: Array<{
    id: number;
    subject: string;
    predicate: string;
    object: string;
    validFromChapter: number;
    validUntilChapter: number | null;
    sourceChapter: number;
  }>;
  summaries: Array<{
    chapter: number;
    title: string;
    characters: string;
    events: string;
    stateChanges: string;
    hookActivity: string;
    mood: string;
    chapterType: string;
  }>;
  hooks: Array<{
    hookId: string;
    startChapter: number;
    type: string;
    status: string;
    lastAdvancedChapter: number;
    expectedPayoff: string;
    notes: string;
  }>;
  nextFactId: number;
  lastProjectedCommit: { commitId: string; chapter: number } | null;
}

class FakeMemoryDB {
  static stores = new Map<string, FakeStore>();

  private readonly store: FakeStore;

  constructor(private readonly bookDir: string) {
    const existing = FakeMemoryDB.stores.get(bookDir);
    if (existing) {
      this.store = existing;
      return;
    }

    const created: FakeStore = {
      facts: [],
      summaries: [],
      hooks: [],
      nextFactId: 1,
      lastProjectedCommit: null,
    };
    FakeMemoryDB.stores.set(bookDir, created);
    this.store = created;
  }

  close(): void {}

  replaceSummaries(summaries: FakeStore["summaries"]): void {
    this.store.summaries = summaries.map((summary) => ({ ...summary }));
  }

  replaceHooks(hooks: FakeStore["hooks"]): void {
    this.store.hooks = hooks.map((hook) => ({ ...hook }));
  }

  resetFacts(): void {
    this.store.facts = [];
    this.store.nextFactId = 1;
  }

  addFact(fact: Omit<FakeStore["facts"][number], "id">): number {
    const id = this.store.nextFactId++;
    this.store.facts.push({ id, ...fact });
    return id;
  }

  invalidateFact(id: number, untilChapter: number): void {
    const index = this.store.facts.findIndex((fact) => fact.id === id);
    if (index >= 0) {
      this.store.facts[index] = {
        ...this.store.facts[index]!,
        validUntilChapter: untilChapter,
      };
    }
  }

  applyCommit(commit: {
    readonly commitId: string;
    readonly chapter: number;
    readonly stateDeltas: ReadonlyArray<{
      readonly subject: string;
      readonly predicate: string;
      readonly newValue: unknown;
    }>;
  }): void {
    if (this.store.lastProjectedCommit?.commitId === commit.commitId) return;
    for (const delta of commit.stateDeltas) {
      const current = this.store.facts.find((fact) =>
        fact.subject === delta.subject
        && fact.predicate === delta.predicate
        && fact.validUntilChapter === null);
      if (current) this.invalidateFact(current.id, commit.chapter);
      this.addFact({
        subject: delta.subject,
        predicate: delta.predicate,
        object: typeof delta.newValue === "string" ? delta.newValue : JSON.stringify(delta.newValue),
        validFromChapter: commit.chapter,
        validUntilChapter: null,
        sourceChapter: commit.chapter,
      });
    }
    this.store.lastProjectedCommit = { commitId: commit.commitId, chapter: commit.chapter };
  }

  getLastProjectedCommit(): { commitId: string; chapter: number } | null {
    return this.store.lastProjectedCommit;
  }

  upsertSummary(summary: FakeStore["summaries"][number]): void {
    this.store.summaries = [
      ...this.store.summaries.filter((item) => item.chapter !== summary.chapter),
      { ...summary },
    ];
  }

  getHook(hookId: string): FakeStore["hooks"][number] | undefined {
    return this.store.hooks.find((hook) => hook.hookId === hookId);
  }

  upsertHook(hook: FakeStore["hooks"][number]): void {
    this.store.hooks = [
      ...this.store.hooks.filter((item) => item.hookId !== hook.hookId),
      { ...hook },
    ];
  }

  indexStoryEvents(): void {}
}

describe("PipelineRunner structured-state memory sync", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../state/memory-db.js");
    FakeMemoryDB.stores.clear();
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("uses structured runtime state as the canonical source for markdown and memory projections", async () => {
    vi.doMock("../state/memory-db.js", () => ({
      MemoryDB: FakeMemoryDB,
    }));

    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");
    const { WriterAgent } = await import("../agents/writer.js");
    const { ContinuityAuditor } = await import("../agents/continuity.js");
    const { StateValidatorAgent } = await import("../agents/state-validator.js");

    root = await mkdtemp(join(tmpdir(), "inoks-story-runner-memory-sync-"));
    const state = new StateManager(root);
    const bookId = "memory-sync-book";
    const now = "2026-03-25T00:00:00.000Z";
    const book: BookConfig = {
      id: bookId,
      title: "Memory Sync Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      language: "en",
      targetChapters: 10,
      chapterWordCount: 10,
      createdAt: now,
      updatedAt: now,
    };

    await state.saveBookConfig(bookId, book);
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Shrine outskirts",
        protagonistState: "Lin Yue begins with the oath token hidden.",
        goal: "Reach the trial city.",
        conflict: "The trial deadline is closing in.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
    ]);

    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,

        },
      } as ConstructorParameters<typeof PipelineRunner>[0]["client"],
      model: "test-model",
      projectRoot: root,
      inputGovernanceMode: "legacy",
    });

    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue({
      chapterNumber: 1,
      title: "Structured Chapter",
      content: "Lin Yue follows the debt into the watchtower archive.",
      wordCount: 9,
      preWriteCheck: "check",
      postSettlement: "settled",
      updatedState: "unused legacy state",
      updatedLedger: "unused legacy ledger",
      updatedHooks: "unused legacy hooks",
      chapterSummary: "| 1 | unused summary |",
      updatedSubplots: "",
      updatedEmotionalArcs: "",
      updatedCharacterMatrix: "",
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: ZERO_USAGE,
      runtimeStateDelta: {
        chapter: 1,
        currentStatePatch: {
          currentGoal: "Trace the debt through the watchtower archive.",
          currentConflict: "Guild pressure keeps colliding with the debt trail.",
        },
        hookOps: {
          upsert: [
            {
              hookId: "structured-hook",
              startChapter: 1,
              type: "relationship",
              status: "open",
              lastAdvancedChapter: 1,
              expectedPayoff: "Reveal why the mentor vanished.",
              notes: "Structured hook should win.",
            },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        newHookCandidates: [],
        chapterSummary: {
          chapter: 1,
          title: "Structured Summary",
          characters: "Lin Yue",
          events: "Lin Yue follows the debt into the watchtower archive.",
          stateChanges: "The debt trail sharpens.",
          hookActivity: "structured-hook advanced",
          mood: "tense",
          chapterType: "investigation",
        },
        subplotOps: [],
        emotionalArcOps: [],
        characterMatrixOps: [],
        notes: [],
      },
    });
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "clean",
      overallScore: 90,
      tokenUsage: ZERO_USAGE,
    });
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
      warnings: [],
      passed: true,
    });
    await runner.writeNextChapter(bookId);

    const narrativeStore = FakeMemoryDB.stores.get(bookDir);
    expect(await readFile(join(storyDir, "pending_hooks.md"), "utf-8")).toContain("structured-hook");
    expect(await readFile(join(storyDir, "pending_hooks.md"), "utf-8")).not.toContain("unused legacy");
    expect(await readFile(join(storyDir, "chapter_summaries.md"), "utf-8")).toContain("Structured Summary");
    expect(await readFile(join(storyDir, "chapter_summaries.md"), "utf-8")).not.toContain("unused summary");
    expect(narrativeStore?.hooks).toEqual([
      expect.objectContaining({
        hookId: "structured-hook",
        notes: "Structured hook should win.",
      }),
    ]);
    expect(narrativeStore?.summaries).toEqual([
      expect.objectContaining({
        chapter: 1,
        title: "Structured Summary",
        events: "Lin Yue follows the debt into the watchtower archive.",
      }),
    ]);
    // Heavy end-to-end test (full writeNextChapter pipeline + sqlite memory.db +
    // structured-state projections). The 5s default is too tight for this under
    // parallel-suite CPU contention; give it explicit headroom.
  }, 20000);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DynamicOutlineRevisionStore,
  DynamicPlotStateStore,
  EventCausalGraphStore,
  TemporalKnowledgeGraphStore,
  allocateEventCharBudget,
  allocateEventsToChapters,
  analyzeNarrativeConcreteness,
  approveAndApplyOutlineRevision,
  auditEmotionTrajectory,
  calculateConcretenessTarget,
  createDefaultEmotionTrajectory,
  detectMissingNarrativeLogic,
  extractNarrativeLogicNodes,
  selectRelevantHistory,
  selectWeightedContext,
  validateEventCausalGraph,
} from "../narrative-research/index.js";
import { ensureChapterSpec, StorySpecStore } from "../story-spec/index.js";
import { buildChapterCommit } from "../story-system/index.js";
import type { ChapterCommit, StoryEvent } from "../story-system/types.js";

const temporaryPaths: string[] = [];

async function temporaryBook(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inoks-narrative-research-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function candidate(overrides: Partial<StoryEvent> = {}): StoryEvent {
  return {
    eventId: "",
    chapter: 1,
    eventType: "location_changed",
    subject: "林舟",
    object: "北城门",
    payload: { predicate: "location", newValue: "北城门" },
    evidence: ["林舟跨进北城门。"],
    confidence: 0.98,
    epistemicStatus: "objective",
    sourceExcerpt: "林舟跨进北城门。",
    sourceStart: 0,
    sourceEnd: 8,
    ...overrides,
  };
}

function acceptedCommit(
  bookDir: string,
  chapter: number,
  events: ReadonlyArray<StoryEvent>,
  parentCommit?: ChapterCommit,
): ChapterCommit {
  return buildChapterCommit({
    bookId: "demo",
    bookDir,
    chapter,
    title: `第${chapter}章`,
    content: `第${chapter}章正文`,
    wordCount: 6,
    chapterPath: join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_test.md`),
    parentCommit,
    proseQualityPassed: true,
    continuityPassed: true,
    fulfillmentPassed: true,
    blockingCount: 0,
    extendedValidation: {
      storyConvergencePassed: true,
      sceneRealizationPassed: true,
      informationDramatizationPassed: true,
      interactionChainPassed: true,
      humanFeelPassed: true,
      emotionPassed: true,
      payoffPassed: true,
      structurePassed: true,
      similarityPassed: true,
      temporalPassed: true,
      humanApprovalPassed: true,
    },
    candidates: { acceptedCandidates: events, ambiguousCandidates: [], rejectedCandidates: [] },
    stateDeltas: events.map((event) => ({
      subject: event.subject,
      predicate: String(event.payload.predicate ?? event.eventType),
      oldValue: "",
      newValue: event.payload.newValue ?? event.object ?? "",
    })),
    summary: {
      chapter,
      title: `第${chapter}章`,
      characters: "林舟",
      events: "移动",
      stateChanges: "位置变化",
      hookActivity: "",
      mood: "",
      chapterType: "",
      text: "移动",
    },
    projectionPayload: {},
  });
}

describe("Narrative Research Adaptation Layer", () => {
  it("allocates more detail to irreversible climax events and detects compressed climaxes", () => {
    const high = calculateConcretenessTarget({
      readerContractImportance: 1,
      mainPlotImportance: 1,
      emotionIntensity: 0.9,
      payoffValue: 1,
      irreversible: true,
      firstAppearance: false,
      climax: true,
      transitionOnly: false,
    });
    const low = calculateConcretenessTarget({
      readerContractImportance: 0.1,
      mainPlotImportance: 0.1,
      emotionIntensity: 0.1,
      payoffValue: 0,
      irreversible: false,
      firstAppearance: false,
      climax: false,
      transitionOnly: true,
    });
    expect(high).toBeGreaterThan(low);
    const events = [{
      id: "climax",
      type: "payoff",
      actors: ["林舟"],
      targetEntities: ["城主"],
      causes: [],
      prerequisites: [],
      expectedEffects: ["身份公开"],
      allocatedChapter: 8,
      allocatedSceneIds: ["s1", "s2"],
      importance: 0.95,
      concretenessTarget: high,
    }];
    const budgets = allocateEventCharBudget({ chapterCharBudget: 3_000, events });
    const report = analyzeNarrativeConcreteness({
      content: "林舟见到城主。身份公开。",
      events,
      plannedBudgets: budgets,
    });
    expect(report[0]?.underExpanded).toBe(true);
  });

  it("allocates causal prerequisites before dependent events and rejects dependency cycles", () => {
    const base = {
      type: "plot",
      actors: ["林舟"],
      targetEntities: [],
      expectedEffects: [],
      importance: 0.8,
      concretenessTarget: 0.8,
      earliestChapter: 1,
      latestChapter: 10,
    };
    const allocated = allocateEventsToChapters({
      startChapter: 1,
      maxEventsPerChapter: 2,
      events: [
        { ...base, id: "e1", causes: [], prerequisites: [] },
        { ...base, id: "e2", causes: ["e1"], prerequisites: [] },
      ],
    });
    expect(allocated[1]!.allocatedChapter).toBeGreaterThan(allocated[0]!.allocatedChapter);
    expect(() => allocateEventsToChapters({
      startChapter: 1,
      maxEventsPerChapter: 2,
      events: [
        { ...base, id: "e1", causes: ["e2"], prerequisites: [] },
        { ...base, id: "e2", causes: ["e1"], prerequisites: [] },
      ],
    })).toThrow(/cycle/i);
  });

  it("projects accepted events into idempotent causal, temporal, and dynamic plot views", async () => {
    const bookDir = await temporaryBook();
    const first = acceptedCommit(bookDir, 1, [candidate({
      eventType: "reader_promise_created",
      subject: "promise-1",
      object: undefined,
      payload: { predicate: "reader-promise", newValue: "created" },
    })]);
    const causal = new EventCausalGraphStore(bookDir);
    await causal.projectCommit(first);
    await causal.projectCommit(first);
    expect(await causal.load()).toHaveLength(1);

    const temporal = new TemporalKnowledgeGraphStore(bookDir);
    await temporal.projectCommit(first);
    await temporal.projectCommit(first);
    expect(await temporal.load()).toHaveLength(1);

    const plot = new DynamicPlotStateStore(bookDir);
    await plot.projectCommit(first);
    await plot.projectCommit(first);
    expect((await plot.load()).activeReaderExpectations).toEqual(["promise-1"]);
  });

  it("retrieves entity-relevant causal history instead of the latest event tail", () => {
    const base = {
      commitId: "commit-1",
      object: undefined,
      actorGoal: undefined,
      prerequisiteEventIds: [] as string[],
      consequenceEventIds: [] as string[],
      stateChanges: [],
      enables: [],
      blocks: [],
      certainty: "objective" as const,
    };
    const events = [
      {
        ...base,
        id: "old-clue",
        subject: { id: "林舟", name: "林舟" },
        predicate: "取得验令簿线索",
        causeEventIds: [],
        time: { chapter: 2 },
        location: { id: "北城门", name: "北城门" },
        provenance: { sourceChapter: 2, sourceCommitId: "commit-1", sourceEventId: "old-clue", evidence: ["旧签名"] },
      },
      {
        ...base,
        id: "old-effect",
        subject: { id: "赵横", name: "赵横" },
        predicate: "隐藏旧签名",
        causeEventIds: ["old-clue"],
        time: { chapter: 3 },
        location: { id: "北城门", name: "北城门" },
        provenance: { sourceChapter: 3, sourceCommitId: "commit-1", sourceEventId: "old-effect", evidence: ["按住纸角"] },
      },
      ...Array.from({ length: 25 }, (_, index) => ({
        ...base,
        id: `recent-${index}`,
        subject: { id: "无关商队", name: "无关商队" },
        predicate: "经过南港",
        causeEventIds: [],
        time: { chapter: 50 + index },
        location: { id: "南港", name: "南港" },
        provenance: { sourceChapter: 50 + index, sourceCommitId: "commit-1", sourceEventId: `recent-${index}`, evidence: [] },
      })),
    ];
    const selected = selectRelevantHistory(events, {
      characterIds: ["赵横"],
      locationIds: ["北城门"],
      entityIds: ["林舟"],
      hookIds: [],
      plannedEventIds: ["old-effect"],
      maxEvents: 5,
    });
    expect(selected.map((event) => event.id)).toEqual(["old-clue", "old-effect"]);
    expect(selected.some((event) => event.id.startsWith("recent-"))).toBe(false);
  });

  it("reports missing causal references and preserves dynamic outline approval audit", async () => {
    const validation = validateEventCausalGraph([{
      id: "e2",
      commitId: "c1",
      subject: { id: "a", name: "a" },
      predicate: "acts",
      causeEventIds: ["e1"],
      prerequisiteEventIds: [],
      consequenceEventIds: [],
      stateChanges: [],
      enables: [],
      blocks: [],
      time: { chapter: 2 },
      certainty: "objective",
      provenance: { sourceChapter: 2, sourceCommitId: "c1", evidence: [] },
    }]);
    expect(validation.passed).toBe(false);
    expect(validation.missingReferences[0]).toContain("e1");

    const bookDir = await temporaryBook();
    const spec = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 2,
    });
    const store = new DynamicOutlineRevisionStore(bookDir);
    const proposed = await store.propose({
      bookId: "demo",
      triggeredByCommitId: "commit-1",
      affectedSpecIds: [spec.id],
      proposedChanges: [{ specId: spec.id, field: "goal", oldValue: "A", newValue: "B" }],
      reasons: ["关系发生变化"],
    });
    expect(proposed.status).toBe("proposed");
    const approved = await approveAndApplyOutlineRevision(bookDir, proposed.id);
    expect(approved.status).toBe("applied");
    expect((await new StorySpecStore(bookDir).loadChapter(2))?.status).toBe("stale");
    expect((await store.list())[0]?.triggeredByCommitId).toBe("commit-1");
  });

  it("keeps protected current facts even when their token cost exceeds the retrieval budget", () => {
    const selection = selectWeightedContext([
      {
        weight: {
          sourceId: "current-fact",
          scope: "book",
          relevance: 1,
          recency: 1,
          authority: 1,
          requiredForCorrectness: true,
        },
        content: "不可压缩的当前事实".repeat(100),
        estimatedTokens: 500,
      },
      {
        weight: {
          sourceId: "old-summary",
          scope: "history",
          relevance: 0.2,
          recency: 0.1,
          authority: 0.2,
          requiredForCorrectness: false,
        },
        content: "旧摘要",
        estimatedTokens: 10,
      },
    ], 100);
    expect(selection.protected[0]?.weight.sourceId).toBe("current-fact");
    expect(selection.selected).toHaveLength(0);
  });

  it("detects unsupported emotion jumps and high-risk event-to-action gaps", () => {
    const target = createDefaultEmotionTrajectory({
      id: "emotion-1",
      goal: "拿到账本",
    });
    const unsafeTarget = {
      ...target,
      nodes: [
        target.nodes[0]!,
        { ...target.nodes[1]!, intensity: 1, triggerEventId: undefined },
      ],
    };
    expect(auditEmotionTrajectory("他突然平静下来。", unsafeTarget).verdict).toBe("block");

    const issues = detectMissingNarrativeLogic(extractNarrativeLogicNodes(
      "城主宣布了处决命令。林舟突然拔刀杀向守卫。",
    ));
    expect(issues.some((issue) => issue.severity === "blocking")).toBe(true);
    expect(issues[0]?.repairCandidates.length).toBeGreaterThan(0);
  });
});

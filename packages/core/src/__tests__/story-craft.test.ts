import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_TROPE_LIBRARY,
  PayoffLedgerStore,
  ReaderContractStore,
  auditPayoff,
  planInformationDelivery,
} from "../story-craft/index.js";
import { buildChapterCommit } from "../story-system/index.js";
import type { ChapterCommit, StoryEvent } from "../story-system/types.js";

const temporaryPaths: string[] = [];

async function temporaryBook(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inoks-story-craft-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function promiseEvent(eventType: string, subject = "promise-1"): StoryEvent {
  return {
    eventId: "",
    chapter: 1,
    eventType,
    subject,
    payload: {
      promise: "林舟公开证明自己的身份",
      type: "identity",
      targetFrom: 2,
      targetTo: 4,
      payoffRequirements: ["公开身份"],
      witnessRequirements: ["城主在场"],
      practicalRewardRequirements: ["获得通行权"],
      consequenceRequirements: ["旧身份评价改变"],
    },
    evidence: ["林舟答应会在城主面前公开证据。"],
    confidence: 0.98,
    epistemicStatus: "objective",
    sourceExcerpt: "林舟答应会在城主面前公开证据。",
    sourceStart: 0,
    sourceEnd: 16,
  };
}

function commit(bookDir: string, event: StoryEvent, parent?: ChapterCommit): ChapterCommit {
  const chapter = parent ? 2 : 1;
  return buildChapterCommit({
    bookId: "demo",
    bookDir,
    chapter,
    title: `第${chapter}章`,
    content: "正文",
    wordCount: 2,
    chapterPath: join(bookDir, "chapters", `${String(chapter).padStart(4, "0")}_test.md`),
    parentCommit: parent,
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
    candidates: {
      acceptedCandidates: [{ ...event, chapter }],
      ambiguousCandidates: [],
      rejectedCandidates: [],
    },
    summary: {
      chapter,
      title: "测试",
      characters: "",
      events: "",
      stateChanges: "",
      hookActivity: "",
      mood: "",
      chapterType: "",
      text: "",
    },
    projectionPayload: {},
  });
}

describe("Reader Contract, Payoff Engine and Trope Library", () => {
  it("versions the reader contract without making it canonical story state", async () => {
    const bookDir = await temporaryBook();
    const store = new ReaderContractStore(bookDir);
    const initial = await store.ensure({ coreFantasy: ["弱者通过规则理解获得选择权"] });
    const updated = await store.save({
      coreFantasy: initial.coreFantasy,
      emotionalPromises: ["受压后得到现实确认"],
      progressionPromises: ["资源逐步可见增长"],
      relationshipPromises: [],
      mysteryPromises: [],
      identityPromises: [],
      forbiddenBetrayals: ["不靠无铺垫降智背叛推进剧情"],
    });
    expect(initial.version).toBe(1);
    expect(updated.version).toBe(2);
    expect(updated.forbiddenBetrayals).toHaveLength(1);
  });

  it("projects promise lifecycle idempotently from accepted commits", async () => {
    const bookDir = await temporaryBook();
    const store = new PayoffLedgerStore(bookDir);
    const created = commit(bookDir, promiseEvent("reader_promise_created"));
    await store.projectCommit(created);
    await store.projectCommit(created);
    expect(await store.load()).toHaveLength(1);
    expect((await store.load())[0]?.buildUpEvents).toHaveLength(1);

    const paid = commit(bookDir, promiseEvent("reader_promise_paid_off"), created);
    await store.projectCommit(paid);
    const entry = (await store.load())[0]!;
    expect(entry.status).toBe("paid_off");
    expect(entry.sourceCommitIds).toHaveLength(2);
    expect(await store.dueAt(5)).toEqual([]);
  });

  it("blocks overdue promises and rejects shock-only fake payoffs as advisory", () => {
    const target = {
      id: "promise-1",
      bookId: "demo",
      type: "identity",
      promise: "林舟公开身份",
      createdChapter: 1,
      relatedCharacters: ["林舟"],
      buildUpEvents: [],
      targetWindow: { from: 2, to: 4 },
      payoffRequirements: ["公开身份"],
      witnessRequirements: ["城主"],
      practicalRewardRequirements: ["通行权"],
      consequenceRequirements: ["评价改变"],
      status: "created" as const,
      sourceCommitIds: ["c1"],
    };
    expect(auditPayoff({ content: "众人赶路。", chapter: 5, targets: [target] }).verdict).toBe("block");
    const fake = auditPayoff({
      content: "林舟公开身份，众人震惊得不敢相信。",
      chapter: 3,
      targets: [target],
    });
    expect(fake.verdict).toBe("revise");
    expect(fake.issues[0]?.message).toContain("缺少主角行动或现实结果");
  });

  it("ships fifteen source-agnostic trope mechanisms with real payoff requirements", () => {
    expect(BUILTIN_TROPE_LIBRARY).toHaveLength(15);
    expect(BUILTIN_TROPE_LIBRARY.every((trope) =>
      trope.requiredBeats.length >= 5
      && trope.requiredPayoffEffects.length > 0
      && trope.forbiddenShortcuts.some((item) => item.includes("震惊")))).toBe(true);
  });

  it("prefers objects, conflict dialogue and reactions before narration", () => {
    const objectPlan = planInformationDelivery({
      fact: "账本被换过",
      readerNeedsNow: true,
      characterKnowledgeState: "林舟知道，掌柜不知道",
      availableObjects: ["墨迹未干的账本"],
    });
    expect(objectPlan.selectedCarriers).toEqual(["object", "reaction"]);
    expect(objectPlan.narrationAllowed).toBe(false);

    const delayed = planInformationDelivery({
      fact: "内应身份",
      readerNeedsNow: false,
      characterKnowledgeState: "无人确认",
    });
    expect(delayed.selectedCarriers).toEqual([]);
    expect(delayed.dramaticMethod).toContain("延迟");
  });
});

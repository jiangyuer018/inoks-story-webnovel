import { describe, expect, it, vi, afterEach } from "vitest";
import * as llmProvider from "../llm/provider.js";
import type { BookConfig } from "../models/book.js";
import type { LLMClient } from "../llm/provider.js";
import { WriterAgent } from "../agents/writer.js";
import {
  HumanSceneRepairAgent,
  SceneRealizationBundleSchema,
  SceneRealizationPlanner,
  SceneSemanticGateError,
  SemanticSceneReviewerAgent,
  evaluateSceneSemanticReviews,
  partitionFinalChapterByScene,
  type SceneRealizationBundle,
  type SemanticSceneReview,
} from "../scene-realization/index.js";
import { ensureChapterSpec } from "../story-spec/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
  defaults: { temperature: 0.7, maxTokens: 4096, thinkingBudget: 0, extra: {} },
};

const BOOK: BookConfig = {
  id: "demo",
  title: "城门账本",
  genre: "urban",
  platform: "qidian",
  status: "active",
  language: "zh",
  targetChapters: 100,
  chapterWordCount: 1000,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function draft(overrides: { oppositionGoal?: string } = {}) {
  return {
    chapterGoal: "林舟在宵禁前迫使赵横登记通行令",
    scenes: [{
      plan: {
        id: "scene-0001-01",
        chapterNumber: 1,
        order: 1,
        location: "北城门验令台",
        time: "宵禁前一刻",
        povCharacterId: "林舟",
        cast: ["林舟", "赵横"],
        immediateGoal: "林舟要让赵横在验令簿上登记通行令",
        oppositionGoal: overrides.oppositionGoal ?? "赵横要拖到宵禁并找到扣押林舟的口实",
        stakes: "宵禁落闸后林舟会失去追踪运粮车的唯一时机",
        entryState: {
          goals: ["林舟必须进城"], relationships: ["双方互不信任"], risks: ["令牌来源暴露"],
          resources: ["未登记通行令"], information: ["林舟不知赵横认识死去的驿卒"],
        },
        exitState: {
          goals: ["林舟进城追运粮车"], relationships: ["赵横派人尾随林舟"], risks: ["守军开始跟踪"],
          resources: ["已登记通行令"], information: ["林舟确认赵横认识驿卒"],
        },
        turningPoint: "林舟发现赵横故意跳过验令簿上的旧签名",
        decisionPoint: "林舟当众要求赵横读出旧签名旁的编号",
        irreversibleChange: "赵横盖章放行，同时命守军记下林舟去向",
        narrativeFunctions: ["兑现通行令阻力", "暴露赵横与驿卒的联系"],
        beatIds: ["beat-0001-goal"],
        status: "generated",
      },
      characterAgendas: [
        {
          characterId: "林舟", wantsNow: "在落闸前完成登记", fearsNow: "令牌血迹引来搜查",
          hides: ["令牌来自死去的驿卒"], cannotSayDirectly: ["驿卒说出的内应姓名"],
          beliefAboutOthers: { 赵横: "他在拖延，而且认得令牌" }, tactic: "用验令规程逼赵横公开落笔",
          leverage: ["围观商旅", "验令簿"], successCondition: "赵横完成登记", retreatCondition: "守军拔刀封锁验令台",
          knowledgeBoundary: { knows: ["令牌编号有效"], doesNotKnow: ["赵横为何认识驿卒"], falselyBelieves: [] },
        },
        {
          characterId: "赵横", wantsNow: "扣下林舟和令牌", fearsNow: "旧签名暴露自己与驿卒相识",
          hides: ["他认得令牌缺口"], cannotSayDirectly: ["内应要求拦截持令者"],
          beliefAboutOthers: { 林舟: "他不知道验令簿的旧签名" }, tactic: "追问来源并拖到落闸",
          leverage: ["守军", "宵禁时限"], successCondition: "林舟说漏令牌来源", retreatCondition: "围观者要求按规程验令",
          knowledgeBoundary: { knows: ["驿卒已经死亡"], doesNotKnow: ["林舟掌握多少线索"], falselyBelieves: ["林舟没看过验令簿"] },
        },
      ],
      informationUnits: [{
        id: "info-1", fact: "赵横认识死去的驿卒", readerNeedsNow: true,
        whoKnows: ["赵横"], whoDoesNotKnow: ["林舟"], whoWantsToHideIt: ["赵横"],
        possibleCarriers: ["observation", "reaction", "dialogue"], selectedCarriers: ["observation", "reaction"],
        deliveryMethod: "赵横跳过旧签名，林舟点名该栏时他下意识按住纸角",
        deliveryEvent: "林舟要求赵横读出旧签名旁编号", consequence: "林舟改变策略，当众逼赵横盖章",
        narrationAllowed: false,
      }],
      interactionTurns: [{
        order: 1, initiator: "赵横", stimulus: "赵横扣住令牌并追问来源", responder: "林舟",
        immediateReaction: "林舟看向验令簿而不是抢令牌", interpretation: "赵横想拖时间且回避登记栏",
        strategyBefore: "解释令牌来历", strategyAfter: "用公开规程施压", outwardActionOrDialogue: "林舟报出编号并要求赵横翻到对应页",
        effectOnOtherCharacter: "赵横必须当众打开验令簿", informationRevealed: ["林舟熟悉验令规程"], informationHidden: ["令牌真实来源"],
      }],
      narrationPermissions: [],
    }],
    concretenessPlan: [{
      eventId: "scene-0001-01", importance: 0.9, emotionalValue: 0.7, irreversibility: 0.8,
      plannedSceneCount: 1, plannedCharBudget: 1000, allowedCompression: false,
    }],
  };
}

function realization(): SceneRealizationBundle {
  return SceneRealizationBundleSchema.parse({
    schemaVersion: "1.0",
    chapterNumber: 1,
    ...draft(),
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceHash: "source-hash-00000001",
    tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  });
}

function semanticReview(
  verdict: SemanticSceneReview["verdict"],
  overrides: Partial<SemanticSceneReview> = {},
): SemanticSceneReview {
  return {
    sceneId: "scene-0001-01",
    narrationUnits: [],
    dialogueTurns: [],
    actions: [],
    thoughts: [],
    environmentDetails: [],
    informationFulfillment: [{
      informationUnitId: "info-1",
      delivered: true,
      carrierUsed: ["observation", "reaction"],
      consequenceVisible: true,
    }],
    interactionFulfillment: [{ turnOrder: 1, fulfilled: true, missingParts: [] }],
    entryExitStateMatch: true,
    unintendedFacts: [],
    missingDramatization: verdict === "repair"
      ? [{ id: "missing-1", severity: "blocking", message: "对白没有改变策略", excerpt: "原对白" }]
      : [],
    verdict,
    ...overrides,
  };
}

function writer() {
  return new WriterAgent({ client: CLIENT, model: "test-model", projectRoot: "C:/tmp" });
}

async function writeRealized(agent: WriterAgent, bundle = realization()) {
  return (agent as unknown as {
    writeRealizedScenes(input: {
      realization: SceneRealizationBundle;
      baseSystemPrompt: string;
      baseUserPrompt: string;
      language: "zh" | "en";
      chapterNumber: number;
      temperature: number;
      countingMode: "chinese-chars";
    }): Promise<{
      creative: { content: string };
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
      sceneReviews: ReadonlyArray<{
        sceneId: string;
        repairIterations: number;
        review: SemanticSceneReview;
      }>;
    }>;
  }).writeRealizedScenes({
    realization: bundle,
    baseSystemPrompt: "system",
    baseUserPrompt: "user",
    language: "zh",
    chapterNumber: 1,
    temperature: 0.7,
    countingMode: "chinese-chars",
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Human Scene Realization", () => {
  it("retries generic placeholder planning and returns a validated concrete bundle", async () => {
    const chat = vi.spyOn(llmProvider, "chatCompletion")
      .mockResolvedValueOnce({
        content: JSON.stringify(draft({ oppositionGoal: "由本章冲突来源阻止目标顺利完成" })),
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>)
      .mockResolvedValueOnce({
        content: JSON.stringify(draft()),
        usage: { promptTokens: 11, completionTokens: 21, totalTokens: 32 },
      } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);
    const result = await new SceneRealizationPlanner({
      client: CLIENT,
      model: "test-model",
      projectRoot: "C:/tmp",
    }).plan({
      book: BOOK,
      chapterNumber: 1,
      intent: { chapter: 1, goal: draft().chapterGoal, mustKeep: [], mustAvoid: [], styleEmphasis: [] },
      targetChars: 1000,
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.scenes[0]?.plan.oppositionGoal).toContain("赵横");
    expect(result.tokenUsage).toEqual({ promptTokens: 21, completionTokens: 41, totalTokens: 62 });
  });

  it("builds an approved Chapter Spec from scene realization without default placeholders", async () => {
    const bookDir = await mkdtemp(join(tmpdir(), "scene-realization-spec-"));
    try {
      const raw = draft();
      const realization = SceneRealizationBundleSchema.parse({
        schemaVersion: "1.0",
        chapterNumber: 1,
        ...raw,
        createdAt: "2026-08-01T00:00:00.000Z",
        sourceHash: "source-hash-00000001",
        tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      });
      const spec = await ensureChapterSpec({
        bookId: "demo",
        bookDir,
        chapterNumber: 1,
        intent: { chapter: 1, goal: raw.chapterGoal, mustKeep: [], mustAvoid: [], styleEmphasis: [] },
        approvalMode: "automatic",
        blockOnPlaceholders: true,
        realization,
      });
      expect(spec.status).toBe("approved");
      expect(spec.sceneRealization?.scenes).toHaveLength(1);
      expect(spec.sceneContracts[0]).toMatchObject({
        pov: "林舟",
        oppositionGoal: expect.stringContaining("赵横"),
      });
    } finally {
      await rm(bookDir, { recursive: true, force: true });
    }
  });

  it("repairs a scene and re-reviews it before allowing assembly", async () => {
    const original = "林舟把令牌推到验令簿边。赵横按住纸角，没有翻页。".repeat(8);
    const repaired = "林舟报出令牌编号。赵横翻到旧签名时按住纸角，林舟当众点破栏号，赵横只得盖章。".repeat(7);
    vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: original,
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);
    const review = vi.spyOn(SemanticSceneReviewerAgent.prototype, "review")
      .mockResolvedValueOnce({ review: semanticReview("repair"), usage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 } })
      .mockResolvedValueOnce({ review: semanticReview("pass"), usage: { promptTokens: 7, completionTokens: 8, totalTokens: 15 } });
    const repair = vi.spyOn(HumanSceneRepairAgent.prototype, "repair").mockResolvedValue({
      content: repaired,
      usage: { promptTokens: 9, completionTokens: 10, totalTokens: 19 },
    });

    const result = await writeRealized(writer());

    expect(result.creative.content).toBe(repaired);
    expect(result.sceneReviews).toEqual([
      expect.objectContaining({
        sceneId: "scene-0001-01",
        repairIterations: 1,
        review: expect.objectContaining({ verdict: "pass" }),
      }),
    ]);
    expect(review).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.usage).toEqual({ promptTokens: 24, completionTokens: 28, totalTokens: 52 });
  });

  it("fails closed on a semantic block without calling the repair model", async () => {
    vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: "林舟与赵横在验令台交锋，守军围在一旁。".repeat(10),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);
    vi.spyOn(SemanticSceneReviewerAgent.prototype, "review").mockResolvedValue({
      review: semanticReview("block", {
        entryExitStateMatch: false,
        unintendedFacts: [{ id: "canon-1", severity: "blocking", message: "新增伤势", excerpt: "他断了一臂" }],
      }),
      usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
    });
    const repair = vi.spyOn(HumanSceneRepairAgent.prototype, "repair");

    await expect(writeRealized(writer())).rejects.toBeInstanceOf(SceneSemanticGateError);
    expect(repair).not.toHaveBeenCalled();
  });

  it("keeps a passing scene idempotent and does not call repair", async () => {
    const prose = "林舟报出栏号，赵横的手停在旧签名上。围观商旅催促落闸前按规验令，他只得盖章。".repeat(7);
    vi.spyOn(llmProvider, "chatCompletion").mockResolvedValue({
      content: prose,
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    } as Awaited<ReturnType<typeof llmProvider.chatCompletion>>);
    vi.spyOn(SemanticSceneReviewerAgent.prototype, "review").mockResolvedValue({
      review: semanticReview("pass"),
      usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
    });
    const repair = vi.spyOn(HumanSceneRepairAgent.prototype, "repair");

    const result = await writeRealized(writer());

    expect(result.creative.content).toBe(prose);
    expect(repair).not.toHaveBeenCalled();
    expect(result.usage.totalTokens).toBe(14);
  });

  it("fails commit-facing semantic dimensions independently and partitions final prose deterministically", () => {
    const bundle = realization();
    const passingRecord = {
      sceneId: "scene-0001-01",
      content: "甲段。\n\n乙段。",
      review: semanticReview("pass"),
      repairIterations: 0,
    } as const;
    expect(evaluateSceneSemanticReviews({ realization: bundle, reviews: [passingRecord] })).toEqual({
      sceneRealizationPassed: true,
      informationDramatizationPassed: true,
      interactionChainPassed: true,
      verdict: "pass",
    });
    const brokenInformation = {
      ...passingRecord,
      review: semanticReview("pass", {
        informationFulfillment: [{
          informationUnitId: "info-1",
          delivered: true,
          carrierUsed: ["observation"],
          consequenceVisible: false,
        }],
      }),
    };
    expect(evaluateSceneSemanticReviews({ realization: bundle, reviews: [brokenInformation] }))
      .toMatchObject({ informationDramatizationPassed: false, verdict: "block" });

    expect(partitionFinalChapterByScene({
      finalContent: "第一场第一段。\n\n第一场第二段。\n\n第二场第一段。\n\n第二场第二段。",
      originalScenes: [
        { ...passingRecord, sceneId: "s1", content: "甲".repeat(20) },
        { ...passingRecord, sceneId: "s2", content: "乙".repeat(20) },
      ],
    })).toEqual([
      "第一场第一段。\n\n第一场第二段。",
      "第二场第一段。\n\n第二场第二段。",
    ]);
  });
});

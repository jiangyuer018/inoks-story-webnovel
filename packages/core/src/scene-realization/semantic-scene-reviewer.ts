import { BaseAgent } from "../agents/base.js";
import { SemanticSceneReviewSchema } from "./schemas.js";
import type { RealizedScene, SemanticSceneReview } from "./types.js";

export class SceneSemanticGateError extends Error {
  readonly code = "SCENE_SEMANTIC_GATE_FAILED";

  constructor(readonly sceneId: string, readonly review: SemanticSceneReview) {
    super(`场景 ${sceneId} 语义审查未通过：${review.verdict}`);
    this.name = "SceneSemanticGateError";
  }
}

export class SemanticSceneReviewerAgent extends BaseAgent {
  get name(): string {
    return "semantic-scene-reviewer";
  }

  async review(input: {
    readonly scene: RealizedScene;
    readonly content: string;
    readonly language: "zh" | "en";
  }): Promise<{ readonly review: SemanticSceneReview; readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const response = await this.chat([
      { role: "system", content: buildReviewSystemPrompt(input.language) },
      {
        role: "user",
        content: [
          `SCENE_PLAN_JSON:\n${JSON.stringify(input.scene, null, 2)}`,
          `SCENE_PROSE:\n${input.content}`,
          "逐项核对所有数组，返回严格 JSON。verdict 只有完全满足时才是 pass；可局部修复用 repair；事实、知识边界或进出状态被破坏用 block。",
        ].join("\n\n"),
      },
    ], { temperature: 0.1 });
    const review = SemanticSceneReviewSchema.parse(parseJsonObject(response.content));
    if (review.sceneId !== input.scene.plan.id) {
      throw new Error(`语义审查 sceneId 不匹配：${review.sceneId} != ${input.scene.plan.id}`);
    }
    return { review, usage: response.usage };
  }
}

function buildReviewSystemPrompt(language: "zh" | "en"): string {
  if (language === "en") {
    return "You are a semantic scene reviewer. Return strict JSON matching the requested review schema. Pass only when goals, interaction dependencies, information carriers, narration permissions, knowledge boundaries, and entry/exit state are all fulfilled.";
  }
  return [
    "你是 InkOS 的语义场景审查器。只返回严格 JSON。",
    "逐段识别旁白、对白、动作、心理和环境，检查其是否承担计划中的叙事功能。",
    "对白必须回应上一轮刺激并改变互动；动作必须有意图和可观察后果；心理必须从观察走向解释并改变信念、策略或决定。",
    "环境必须影响行动、风险、线索或必要气氛；否则标记 removableWithoutLoss。",
    "没有 NarrationPermission 的解释性旁白不能通过。双方都知道的设定说明、重复动作情绪、作者总结均不能通过。",
    "检查每个 informationUnit 和 interactionTurn 是否实现，检查人物知识边界、未计划事实和进出状态。",
    "只有所有 blocking 问题为零、信息与互动完整、entryExitStateMatch=true 时 verdict=pass。需要改写承载方式时 verdict=repair。改变正史或知识边界时 verdict=block。",
    "JSON 字段必须包含：sceneId,narrationUnits,dialogueTurns,actions,thoughts,environmentDetails,informationFulfillment,interactionFulfillment,entryExitStateMatch,unintendedFacts,missingDramatization,verdict。",
  ].join("\n");
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("语义审查未返回 JSON 对象");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

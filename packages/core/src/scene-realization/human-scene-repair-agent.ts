import { BaseAgent } from "../agents/base.js";
import type { SceneRepairInput } from "./types.js";

export class HumanSceneRepairAgent extends BaseAgent {
  get name(): string {
    return "human-scene-repair";
  }

  async repair(input: SceneRepairInput & { readonly language: "zh" | "en" }): Promise<{
    readonly content: string;
    readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    const response = await this.chat([
      { role: "system", content: buildRepairSystemPrompt(input.language) },
      {
        role: "user",
        content: [
          `SCENE_PLAN_JSON:\n${JSON.stringify(input.scenePlan, null, 2)}`,
          `CHARACTER_AGENDAS_JSON:\n${JSON.stringify(input.characterAgendas, null, 2)}`,
          `INFORMATION_UNITS_JSON:\n${JSON.stringify(input.informationUnits, null, 2)}`,
          `INTERACTION_TURNS_JSON:\n${JSON.stringify(input.interactionTurns, null, 2)}`,
          `NARRATION_PERMISSIONS_JSON:\n${JSON.stringify(input.narrationPermissions, null, 2)}`,
          `SEMANTIC_REVIEW_JSON:\n${JSON.stringify(input.review, null, 2)}`,
          `IMMUTABLE_FACTS:\n${input.immutableFacts.map((fact) => `- ${fact}`).join("\n")}`,
          `ALLOWED_CHANGES:\n${input.allowedChanges.map((change) => `- ${change}`).join("\n")}`,
          `ORIGINAL_SCENE:\n${input.originalScene}`,
          "返回完整修订场景正文，不要说明。",
        ].join("\n\n"),
      },
    ], { temperature: 0.35 });
    const content = clean(response.content);
    if (content.length < 100) throw new Error("场景修复返回空文本或过短文本");
    return { content, usage: response.usage };
  }
}

function buildRepairSystemPrompt(language: "zh" | "en"): string {
  if (language === "en") {
    return "Repair only the semantic issues identified in the review. Preserve canon, knowledge boundaries, event outcomes, entry/exit states, and voice. Return scene prose only.";
  }
  return [
    "你正在执行“真人场景重构修复”，不是续写，也不是同义词润色。只返回完整场景正文。",
    "保持正史事实、人物知识边界、事件结果、进入状态、离开状态、人物声口和必要伏笔不变。",
    "把可戏剧化的作者说明改造成：观察 → 判断 → 试探或选择 → 对方反应 → 现实后果。",
    "删除无功能环境、重复解释和情绪命名；不得用握拳、皱眉、叹气等模板动作替代真实行为。",
    "只修复 review 指出的表达承载和互动缺口，以及维持上下文通顺所必需的相邻句。",
    "禁止新增人物、关系、能力、伤势、知识、时间、地点、数字、物品和世界规则。",
    "禁止把所有句子改短，禁止故意写错字、病句或随机标点。",
  ].join("\n");
}

function clean(raw: string): string {
  return raw.trim().replace(/^```(?:markdown|md|text)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

import type { BookConfig } from "../models/book.js";
import type { ChapterIntent, ChapterMemo, ContextPackage } from "../models/input-governance.js";
import { BaseAgent } from "../agents/base.js";
import { canonicalJson, sha256 } from "../story-system/commit.js";
import { SceneRealizationDraftSchema } from "./schemas.js";
import type { SceneRealizationBundle } from "./types.js";
import { findPlaceholderPhrases } from "./placeholder-detector.js";

export interface PlanSceneRealizationInput {
  readonly book: BookConfig;
  readonly chapterNumber: number;
  readonly intent?: ChapterIntent;
  readonly memo?: ChapterMemo;
  readonly contextPackage?: ContextPackage;
  readonly targetChars: number;
}

export class SceneRealizationPlanningError extends Error {
  readonly code = "SCENE_REALIZATION_PLANNING_FAILED";

  constructor(readonly issues: ReadonlyArray<string>) {
    super(`真实场景规划失败，未进入 Writer：${issues.join("；")}`);
    this.name = "SceneRealizationPlanningError";
  }
}

export class SceneRealizationPlanner extends BaseAgent {
  get name(): string {
    return "scene-realization-planner";
  }

  async plan(input: PlanSceneRealizationInput): Promise<SceneRealizationBundle> {
    const language = input.book.language ?? "zh";
    const source = {
      chapterNumber: input.chapterNumber,
      intent: input.intent ?? null,
      memo: input.memo ?? null,
      context: input.contextPackage?.selectedContext ?? [],
      targetChars: input.targetChars,
    };
    const sourceHash = sha256(canonicalJson(source));
    const basePrompt = this.buildUserPrompt(input);
    let feedback = "";
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let lastIssues: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.chat([
        { role: "system", content: this.buildSystemPrompt(language) },
        {
          role: "user",
          content: feedback ? `${basePrompt}\n\n上次输出问题：\n${feedback}\n请完整重发 JSON。` : basePrompt,
        },
      ], { temperature: 0.35 });
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens += response.usage.totalTokens;
      try {
        const draft = SceneRealizationDraftSchema.parse(parseJsonObject(response.content));
        const issues = validateDraft(draft, input);
        if (issues.length > 0) {
          lastIssues = issues;
          feedback = issues.map((issue) => `- ${issue}`).join("\n");
          continue;
        }
        return {
          schemaVersion: "1.0",
          chapterNumber: input.chapterNumber,
          ...draft,
          createdAt: new Date().toISOString(),
          sourceHash,
          tokenUsage: usage,
        };
      } catch (error) {
        lastIssues = [error instanceof Error ? error.message : String(error)];
        feedback = lastIssues.map((issue) => `- ${issue}`).join("\n");
      }
    }
    throw new SceneRealizationPlanningError(lastIssues.length > 0 ? lastIssues : ["模型未返回有效 JSON"]);
  }

  private buildSystemPrompt(language: "zh" | "en"): string {
    if (language === "en") {
      return "You are the scene realization planner. Return strict JSON only. Turn chapter intent into concrete scenes, agendas, information carriers, interaction turns, narration permissions, and event budgets. Never use generic placeholders.";
    }
    return [
      "你是 InkOS 的真人场景实现规划器。只返回严格 JSON，不要 Markdown。",
      "你不写正文。把章节意图编译成具体场景、人物议程、信息承载、刺激—反应互动轮、旁白许可和篇幅预算。",
      "每个主要角色必须有当场欲望、恐惧、隐瞒、知识边界、策略、筹码与退出条件。",
      "每轮互动必须由上一轮刺激引发，并改变至少一方判断、策略、风险、关系或信息。",
      "信息优先通过对话争夺、动作后果、物件、观察和反应传递；旁白只有必要原因时允许。",
      "禁止使用“维护自己的利益与立场”“由剧情决定”“产生可验证变化”等通用占位语。",
      "不得新增大纲没有支持的正史事件、能力、关系、物品、数字或世界规则。",
      "JSON 根字段：chapterGoal, scenes, concretenessPlan。",
      "scenes 每项字段：plan, characterAgendas, informationUnits, interactionTurns, narrationPermissions。",
      "plan 必含 id,chapterNumber,order,location,time,povCharacterId,cast,immediateGoal,oppositionGoal,stakes,entryState,exitState,turningPoint,decisionPoint,irreversibleChange,narrativeFunctions,beatIds,status。",
    ].join("\n");
  }

  private buildUserPrompt(input: PlanSceneRealizationInput): string {
    const context = (input.contextPackage?.selectedContext ?? [])
      .map((item) => `- ${item.source}（${item.reason}）\n${item.excerpt ?? ""}`)
      .join("\n");
    return [
      `书名：${input.book.title}`,
      `章节：${input.chapterNumber}`,
      `目标字数：${input.targetChars}`,
      `章节目标：${input.intent?.goal ?? input.memo?.goal ?? ""}`,
      `大纲节点：${input.intent?.outlineNode ?? ""}`,
      `剧情弧：${input.intent?.arcContext ?? ""}`,
      `必须保留：${(input.intent?.mustKeep ?? []).join("；")}`,
      `禁止改变：${(input.intent?.mustAvoid ?? []).join("；")}`,
      "",
      "章节 memo：",
      input.memo?.body ?? "",
      "",
      "相关正史与规划上下文：",
      context || "（无额外上下文；不得自行补造正史）",
      "",
      "生成 1—5 个具体场景。场景边界只在地点、时间、主要目标、主要阻力者、策略阶段或状态发生实质变化时切分。",
      "plannedCharBudget 总和应接近目标字数；高潮和不可逆事件分配更多篇幅，过渡允许压缩。",
    ].join("\n");
  }
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("未找到 JSON 对象");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function validateDraft(
  draft: ReturnType<typeof SceneRealizationDraftSchema.parse>,
  input: PlanSceneRealizationInput,
): string[] {
  const issues: string[] = [];
  const placeholders = findPlaceholderPhrases([canonicalJson(draft)]);
  if (placeholders.length > 0) issues.push(`仍含通用占位语：${placeholders.join("、")}`);
  const sceneIds = new Set<string>();
  draft.scenes.forEach((scene, index) => {
    const expectedOrder = index + 1;
    if (scene.plan.chapterNumber !== input.chapterNumber) issues.push(`${scene.plan.id} 章节号不匹配`);
    if (scene.plan.order !== expectedOrder) issues.push(`${scene.plan.id} order 应为 ${expectedOrder}`);
    if (sceneIds.has(scene.plan.id)) issues.push(`重复 scene id：${scene.plan.id}`);
    sceneIds.add(scene.plan.id);
    if (!scene.plan.cast.includes(scene.plan.povCharacterId)) issues.push(`${scene.plan.id} POV 不在 cast 中`);
    const agendaIds = new Set(scene.characterAgendas.map((agenda) => agenda.characterId));
    for (const character of scene.plan.cast) {
      if (!agendaIds.has(character)) issues.push(`${scene.plan.id} 缺少 ${character} 的人物议程`);
    }
    if (canonicalJson(scene.plan.entryState) === canonicalJson(scene.plan.exitState)) {
      issues.push(`${scene.plan.id} 进入和退出状态完全相同`);
    }
    const infoIds = new Set(scene.informationUnits.map((unit) => unit.id));
    const permissionIds = new Set(scene.narrationPermissions.map((permission) => permission.informationUnitId));
    for (const unit of scene.informationUnits) {
      if (unit.selectedCarriers.includes("narration") && (!unit.narrationAllowed || !permissionIds.has(unit.id))) {
        issues.push(`${scene.plan.id} 的 ${unit.id} 使用旁白但没有许可`);
      }
      if (!unit.selectedCarriers.includes("narration") && unit.narrationAllowed && !unit.narrationReason) {
        issues.push(`${scene.plan.id} 的 ${unit.id} 允许旁白但缺少原因`);
      }
    }
    for (const permission of scene.narrationPermissions) {
      if (!infoIds.has(permission.informationUnitId)) {
        issues.push(`${scene.plan.id} 的旁白许可引用未知信息单元 ${permission.informationUnitId}`);
      }
    }
    scene.interactionTurns.forEach((turn, turnIndex) => {
      if (turn.order !== turnIndex + 1) issues.push(`${scene.plan.id} 互动轮 order 不连续`);
      if (!scene.plan.cast.includes(turn.initiator) || !scene.plan.cast.includes(turn.responder)) {
        issues.push(`${scene.plan.id} 互动轮引用了 cast 外人物`);
      }
    });
  });
  const totalBudget = draft.concretenessPlan.reduce((sum, item) => sum + item.plannedCharBudget, 0);
  if (totalBudget < input.targetChars * 0.7 || totalBudget > input.targetChars * 1.3) {
    issues.push(`场景篇幅预算 ${totalBudget} 与目标 ${input.targetChars} 偏差超过 30%`);
  }
  return issues;
}

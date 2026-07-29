import type { EmotionTrajectory, EmotionTrajectoryNode } from "./types.js";

export interface EmotionReviewIssue {
  readonly id: string;
  readonly severity: "info" | "warning" | "blocking";
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly suggestion: string;
}

export interface EmotionTrajectoryAudit {
  readonly targetTrajectoryId: string;
  readonly actualTrajectory: EmotionTrajectory;
  readonly directLabelingProblems: ReadonlyArray<EmotionReviewIssue>;
  readonly missingTransitions: ReadonlyArray<EmotionReviewIssue>;
  readonly trajectoryDeviation: ReadonlyArray<EmotionReviewIssue>;
  readonly verdict: "pass" | "revise" | "block";
}

const EMOTION_TERMS: Readonly<Record<string, ReadonlyArray<string>>> = {
  愤怒: ["愤怒", "怒火", "恼怒", "气得", "暴怒"],
  恐惧: ["恐惧", "害怕", "惊惧", "发怵", "胆寒"],
  悲伤: ["悲伤", "难过", "悲痛", "哀恸", "鼻酸"],
  喜悦: ["喜悦", "高兴", "欣喜", "畅快", "松快"],
  紧张: ["紧张", "绷紧", "戒备", "警觉", "压力"],
  决断: ["决定", "决断", "下定", "选择", "不再犹豫"],
};

export function createDefaultEmotionTrajectory(params: {
  readonly id: string;
  readonly ownerCharacterId?: string;
  readonly goal: string;
  readonly payoffTargets?: ReadonlyArray<string>;
}): EmotionTrajectory {
  const payoff = (params.payoffTargets?.length ?? 0) > 0;
  return {
    id: params.id,
    ownerCharacterId: params.ownerCharacterId ?? "pov",
    scope: "chapter",
    nodes: [
      {
        order: 1,
        emotion: "警觉",
        intensity: 0.35,
        beliefState: `目标仍未完成：${params.goal}`,
        behavioralEffect: "观察阻力并选择第一种策略",
      },
      {
        order: 2,
        emotion: payoff ? "压力" : "受阻",
        intensity: 0.65,
        beliefState: "原策略不足以直接完成目标",
        behavioralEffect: "重新评估风险、关系或资源",
        expectedDecisionChange: "放弃无成本方案并承担代价",
      },
      {
        order: 3,
        emotion: payoff ? "释放" : "决断",
        intensity: payoff ? 0.5 : 0.6,
        beliefState: "选择已经改变局势，必须承受后果",
        behavioralEffect: "以可观察行动进入下一状态",
      },
    ],
  };
}

export function auditEmotionTrajectory(
  content: string,
  target: EmotionTrajectory,
): EmotionTrajectoryAudit {
  const actualNodes = extractEmotionNodes(content);
  const actualTrajectory: EmotionTrajectory = {
    id: `${target.id}:actual`,
    ownerCharacterId: target.ownerCharacterId,
    scope: target.scope,
    nodes: actualNodes,
  };
  const directLabelingProblems = detectDirectLabeling(content);
  const missingTransitions = detectMissingTransitions(target);
  const trajectoryDeviation: EmotionReviewIssue[] = [];
  if (target.nodes.length > 0 && actualNodes.length === 0) {
    trajectoryDeviation.push({
      id: "emotion-no-observable-trajectory",
      severity: "warning",
      message: "正文没有可定位的情绪—判断—行为轨迹。",
      start: 0,
      end: Math.min(content.length, 80),
      suggestion: "补充触发、判断和选择造成的动作后果，不要只添加情绪词。",
    });
  }
  const issues = [...directLabelingProblems, ...missingTransitions, ...trajectoryDeviation];
  return {
    targetTrajectoryId: target.id,
    actualTrajectory,
    directLabelingProblems,
    missingTransitions,
    trajectoryDeviation,
    verdict: issues.some((issue) => issue.severity === "blocking")
      ? "block"
      : issues.some((issue) => issue.severity === "warning")
        ? "revise"
        : "pass",
  };
}

function extractEmotionNodes(content: string): ReadonlyArray<EmotionTrajectoryNode> {
  const candidates: Array<{ emotion: string; index: number }> = [];
  for (const [emotion, terms] of Object.entries(EMOTION_TERMS)) {
    for (const term of terms) {
      let from = 0;
      while (from < content.length) {
        const index = content.indexOf(term, from);
        if (index < 0) break;
        candidates.push({ emotion, index });
        from = index + term.length;
      }
    }
  }
  return candidates.sort((left, right) => left.index - right.index).slice(0, 12).map((candidate, order) => {
    const context = content.slice(Math.max(0, candidate.index - 30), candidate.index + 60);
    return {
      order: order + 1,
      emotion: candidate.emotion,
      intensity: estimateIntensity(context),
      beliefState: context,
      behavioralEffect: extractBehavior(context),
    };
  });
}

function detectDirectLabeling(content: string): ReadonlyArray<EmotionReviewIssue> {
  const pattern = /(?:他|她|[\p{Script=Han}]{2,4})(?:感到|觉得|内心充满了?|心中满是)(愤怒|悲伤|恐惧|喜悦|绝望|震惊)/gu;
  return [...content.matchAll(pattern)].map((match, index) => ({
    id: `emotion-direct-label-${index + 1}`,
    severity: "warning",
    message: `直接给情绪命名：${match[0]}`,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    suggestion: "用人物看到什么、如何判断、采取什么策略以及对方如何反应来承载情绪。",
  }));
}

function detectMissingTransitions(target: EmotionTrajectory): ReadonlyArray<EmotionReviewIssue> {
  const issues: EmotionReviewIssue[] = [];
  for (let index = 1; index < target.nodes.length; index += 1) {
    const previous = target.nodes[index - 1]!;
    const current = target.nodes[index]!;
    if (Math.abs(current.intensity - previous.intensity) < 0.45 || current.triggerEventId) continue;
    issues.push({
      id: `emotion-transition-${index}`,
      severity: "blocking",
      message: `${previous.emotion}到${current.emotion}的强度跳变缺少触发事件。`,
      start: 0,
      end: 0,
      suggestion: "在轨迹中指定触发事件，并在正文展示感知、判断和行为变化。",
    });
  }
  return issues;
}

function estimateIntensity(context: string): number {
  const amplifiers = (context.match(/极|猛|骤|死死|无法|再也|当场/g) ?? []).length;
  return Math.min(1, 0.35 + amplifiers * 0.12);
}

function extractBehavior(context: string): string {
  const sentence = context.split(/[。！？!?]/).find((item) =>
    /走|退|抓|放|推|拿|转|开口|沉默|看|问|答|选择|决定/.test(item));
  return sentence?.trim() ?? "";
}

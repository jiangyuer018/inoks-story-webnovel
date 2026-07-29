import { createHash } from "node:crypto";
import { classifyNarrativeSegments } from "./segment-classifier.js";
import type {
  ClassifiedNarrativeSegment,
  HumanFeelAuditOptions,
  HumanFeelIssue,
  HumanFeelIssueCategory,
  HumanFeelReport,
  HumanFeelSuggestion,
} from "./types.js";

export const HUMAN_FEEL_RULE_VERSION = "inoks-story-human-feel/1.0.0";

const GENERIC_METAPHORS = [
  "空气仿佛凝固",
  "夜色如墨",
  "愤怒如潮水",
  "像刀子一样锋利",
  "心像被针扎",
  "树影如鬼魅",
  "时间仿佛静止",
  "平静的湖面投下一颗石子",
];

const EMPTY_ACTIONS = [
  "点了点头",
  "摇了摇头",
  "叹了口气",
  "深吸一口气",
  "握紧了拳头",
  "咬紧牙关",
  "目光闪烁",
  "身体微微一震",
  "嘴角勾起",
];

export function auditHumanFeel(
  content: string,
  options: HumanFeelAuditOptions = {},
): HumanFeelReport {
  const contentHash = createHash("sha256").update(content, "utf-8").digest("hex");
  if (!content.trim() || options.language === "en") {
    return emptyReport(contentHash);
  }
  const segments = classifyNarrativeSegments(content);
  const issues = [
    ...detectExposition(segments),
    ...detectDecorativeEnvironment(segments),
    ...detectGenericMetaphors(segments),
    ...detectEmptyActions(segments),
    ...detectRedundantThought(segments),
    ...detectArtificialDialogue(segments),
    ...detectReactionCoupling(segments),
    ...detectSceneStagnation(segments),
    ...detectOverNeatPlot(segments),
    ...detectExcessiveExplanation(segments),
  ].filter((issue) =>
    !options.lockedParagraphs?.has(issue.paragraphIndex)
    && !options.ignoredIssueIds?.has(issue.id));
  const grouped = (category: HumanFeelIssueCategory) =>
    issues.filter((issue) => issue.category === category);
  const blockingIssues = issues.filter((issue) => issue.severity === "blocking");
  const advisoryCount = issues.filter((issue) => issue.severity === "advisory").length;
  const infoCount = issues.filter((issue) => issue.severity === "info").length;
  const score = Math.max(0, Math.round(100 - blockingIssues.length * 18 - advisoryCount * 4 - infoCount));
  const suggestions = issues.map(buildSuggestion);
  const counts = classMetrics(segments);
  return {
    score,
    segments,
    expositionIssues: grouped("exposition"),
    decorativeEnvironmentIssues: grouped("decorative-environment"),
    genericMetaphorIssues: grouped("generic-metaphor"),
    emptyActionIssues: grouped("empty-action"),
    redundantThoughtIssues: grouped("redundant-thought"),
    artificialDialogueIssues: grouped("artificial-dialogue"),
    reactionCouplingIssues: grouped("reaction-coupling"),
    sceneStagnationIssues: grouped("scene-stagnation"),
    overNeatPlotIssues: grouped("over-neat-plot"),
    excessiveExplanationIssues: grouped("excessive-explanation"),
    blockingIssues,
    suggestions,
    verdict: blockingIssues.length > 0 ? "block" : issues.length > 0 ? "revise" : "pass",
    metrics: {
      ...counts,
      blockingCount: blockingIssues.length,
      advisoryCount,
      infoCount,
      paragraphCount: segments.length,
    },
    ruleVersion: HUMAN_FEEL_RULE_VERSION,
    contentHash,
    createdAt: new Date().toISOString(),
  };
}

function detectExposition(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments.flatMap((segment) => {
    const matches = segment.text.match(/这意味着|也就是说|换句话说|原因(?:是|在于)|之所以|事实上|显而易见|不难看出/g) ?? [];
    if (matches.length < 2 && segment.classification !== "X") return [];
    return [issue(segment, "exposition", matches.length >= 3 ? "blocking" : "advisory",
      "解释链代替了场内信息传递。",
      "本段连续告诉读者如何理解，而不是让人物行为、冲突对白或后果提供证据。",
      "保留理解情节所需的一条信息，其余改由动作、物件、对方反应或选择后果承担。")];
  });
}

function detectDecorativeEnvironment(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments
    .filter((segment) => segment.classification === "O" && /风|雨|雪|雾|夜色|月光|天空|空气|树影/.test(segment.text))
    .map((segment) => issue(segment, "decorative-environment", "advisory",
      "环境描写没有可定位的叙事作用。",
      "本段未显示人物与环境互动，也未改变风险、阻力、线索或判断。",
      "压缩为一个有效细节，或让该环境直接影响人物行动。"));
}

function detectGenericMetaphors(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments.flatMap((segment) => GENERIC_METAPHORS
    .filter((phrase) => segment.text.includes(phrase))
    .map((phrase) => issue(segment, "generic-metaphor", "advisory",
      `通用公共比喻：“${phrase}”。`,
      "该比喻不能体现当前视角人物的职业、经历或判断方式。",
      "删除装饰，或改成视角人物会自然联想到且能帮助判断/行动的具体参照。", phrase)));
}

function detectEmptyActions(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments.flatMap((segment) => {
    const matches = EMPTY_ACTIONS.filter((phrase) => segment.text.includes(phrase));
    if (matches.length === 0) return [];
    const hasEffect = /于是|逼得|让|使|因此|打断|挡住|换来|引得|导致|对方|门|物件|退|停|改口/.test(segment.text);
    if (hasEffect && matches.length === 1) return [];
    return [issue(segment, "empty-action", matches.length >= 3 ? "blocking" : "advisory",
      `模板微动作缺少意图或后果：${matches.join("、")}。`,
      "动作没有改变谈话节奏、关系、风险、资源、信息或下一步选择。",
      "删除无功能动作，或让动作成为试探、遮掩、威胁、争夺或实际操作。")];
  });
}

function detectRedundantThought(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments
    .filter((segment) =>
      /心里|心中|想到|意识到|明白|感到/.test(segment.text)
      && (
        !/决定|选择|于是|转而|改变主意|必须|宁可/.test(segment.text)
        || /没有改变|并未改变|却没决定|仍未决定/.test(segment.text)
      ))
    .map((segment) => issue(segment, "redundant-thought", "advisory",
      "心理描写没有推进判断或决策。",
      "本段给出了情绪/认识，但没有改变人物策略或下一步行动。",
      "压缩情绪命名，补足新的判断与选择；若不影响行动则删除。"));
}

function detectArtificialDialogue(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments.flatMap((segment) => {
    if (segment.classification !== "D") return [];
    const infoDump = /你(?:也|应该)?知道|正如你所知|让我告诉你|事情是这样的|众所周知|简单来说/.test(segment.text);
    const longTurn = Math.max(...(segment.text.match(/[“"][^”"]+[”"]/g) ?? [""]).map((turn) => turn.length)) > 180;
    if (!infoDump && !longTurn) return [];
    return [issue(segment, "artificial-dialogue", infoDump && longTurn ? "blocking" : "advisory",
      "对白像给读者讲背景，而不是人物争取利益。",
      "台词缺少回避、试探、隐瞒、风险差异或对方打断。",
      "把信息拆成有代价的问答、试探或误解，让双方只说自己愿意说的部分。")];
  });
}

function detectReactionCoupling(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments.flatMap((segment) => {
    if (segment.classification !== "D") return [];
    const turns = segment.text.match(/[“"][^”"]+[”"]/g) ?? [];
    if (turns.length < 3) return [];
    const coupled = turns.slice(1).filter((turn) =>
      /你|这|那|刚才|所以|可是|凭什么|别|回答|问|打断|看着|盯着/.test(turn)).length;
    if (coupled / (turns.length - 1) >= 0.25) return [];
    return [issue(segment, "reaction-coupling", "advisory",
      "多轮对白缺少对上一句的刺激—反应耦合。",
      "相邻台词像独立陈述，删除上一句后下一句仍然完全成立。",
      "让后一句针对前一句的用词、隐瞒、威胁或误解改变策略。")];
  });
}

function detectSceneStagnation(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  const hasStateChange = segments.some((segment) =>
    /决定|得到|失去|发现|暴露|改变|答应|拒绝|离开|进入|拿到|交出|打破|关闭|开启|受伤|死亡/.test(segment.text));
  if (hasStateChange) return [];
  const totalLength = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (totalLength < 500) return [];
  const anchor = segments.at(-1)!;
  return [issue(anchor, "scene-stagnation", "blocking",
    "长场景结束后没有可验证的状态变化。",
    "目标、关系、风险、资源、信息、伏笔和下一步行动都没有明确变化。",
    "在场内补足人物选择及其不可无成本撤销的后果，或删除该无效场景。")];
}

function detectOverNeatPlot(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  if (segments.length < 6) return [];
  const lengths = segments.map((segment) => segment.text.length);
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  if (mean < 10) return [];
  const deviation = Math.sqrt(lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length);
  if (deviation / mean > 0.12) return [];
  return [issue(segments[0]!, "over-neat-plot", "advisory",
    "连续段落长度和展开方式过度整齐。",
    "不同叙事功能被分配了近似篇幅，读感像按模板逐段完成。",
    "按冲突价值调整展开：重要选择和后果展开，过渡压缩。")];
}

function detectExcessiveExplanation(segments: ReadonlyArray<ClassifiedNarrativeSegment>): HumanFeelIssue[] {
  return segments.flatMap((segment) => {
    const repeatedEmotion = /(?:握紧|咬紧|发抖|退后|沉默)[^。！？]{0,28}(?:因为|说明|显然|可见)[^。！？]{0,28}(?:害怕|愤怒|紧张|悲伤)/.test(segment.text);
    if (!repeatedEmotion) return [];
    return [issue(segment, "excessive-explanation", "advisory",
      "动作已经表达情绪，旁白又解释了一遍。",
      "读者已经能从动作及场内反应判断情绪。",
      "保留动作和后果，删除情绪结论或作者解释。")];
  });
}

function issue(
  segment: ClassifiedNarrativeSegment,
  category: HumanFeelIssueCategory,
  severity: HumanFeelIssue["severity"],
  message: string,
  rationale: string,
  suggestion: string,
  excerpt = segment.text.slice(0, 120),
): HumanFeelIssue {
  const local = Math.max(0, segment.text.indexOf(excerpt));
  return {
    id: `human-feel-${category}-${segment.paragraphIndex + 1}-${local}`,
    category,
    severity,
    message,
    rationale,
    suggestion,
    paragraphIndex: segment.paragraphIndex,
    start: segment.start + local,
    end: segment.start + local + excerpt.length,
    excerpt,
  };
}

function buildSuggestion(issue: HumanFeelIssue): HumanFeelSuggestion {
  const action: HumanFeelSuggestion["action"] =
    issue.category === "generic-metaphor" ? "delete"
      : issue.category === "reaction-coupling" ? "add-bridge"
        : issue.category === "exposition" || issue.category === "artificial-dialogue" ? "dramatize"
          : "local-rewrite";
  return {
    issueId: issue.id,
    action,
    scope: issue.category === "reaction-coupling" ? "adjacent-paragraphs" : "paragraph",
    instruction: issue.suggestion,
  };
}

function classMetrics(segments: ReadonlyArray<ClassifiedNarrativeSegment>): Record<string, number> {
  const total = Math.max(1, segments.length);
  const result: Record<string, number> = {};
  for (const code of ["D", "A", "T", "E", "N", "X", "O"] as const) {
    result[`segmentRatio${code}`] = Math.round(
      segments.filter((segment) => segment.classification === code).length / total * 1000,
    ) / 1000;
  }
  return result;
}

function emptyReport(contentHash: string): HumanFeelReport {
  return {
    score: 100,
    segments: [],
    expositionIssues: [],
    decorativeEnvironmentIssues: [],
    genericMetaphorIssues: [],
    emptyActionIssues: [],
    redundantThoughtIssues: [],
    artificialDialogueIssues: [],
    reactionCouplingIssues: [],
    sceneStagnationIssues: [],
    overNeatPlotIssues: [],
    excessiveExplanationIssues: [],
    blockingIssues: [],
    suggestions: [],
    verdict: "pass",
    metrics: { paragraphCount: 0, blockingCount: 0, advisoryCount: 0, infoCount: 0 },
    ruleVersion: HUMAN_FEEL_RULE_VERSION,
    contentHash,
    createdAt: new Date().toISOString(),
  };
}

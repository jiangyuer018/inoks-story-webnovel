import type {
  MissingNarrativeLogicIssue,
  NarrativeBridgeCandidate,
  NarrativeLogicNode,
  NarrativeLogicNodeType,
} from "./types.js";

const EXPECTED_ORDER: ReadonlyArray<NarrativeLogicNodeType> = [
  "event",
  "perception",
  "emotion",
  "belief",
  "decision",
  "action",
  "consequence",
];

export function extractNarrativeLogicNodes(content: string): ReadonlyArray<NarrativeLogicNode> {
  const sentences = [...content.matchAll(/[^。！？!?\n]+[。！？!?]?/g)];
  return sentences.map((match, index) => {
    const text = match[0].trim();
    return {
      id: `logic-${index + 1}`,
      type: classifyNode(text),
      text,
      sourceStart: match.index ?? 0,
      sourceEnd: (match.index ?? 0) + match[0].length,
    };
  }).filter((node) => node.text.length > 0);
}

export function detectMissingNarrativeLogic(
  nodes: ReadonlyArray<NarrativeLogicNode>,
): ReadonlyArray<MissingNarrativeLogicIssue> {
  const issues: MissingNarrativeLogicIssue[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const fromNode = nodes[index - 1]!;
    const toNode = nodes[index]!;
    const fromIndex = EXPECTED_ORDER.indexOf(fromNode.type);
    const toIndex = EXPECTED_ORDER.indexOf(toNode.type);
    if (fromIndex < 0 || toIndex < 0 || toIndex <= fromIndex + 1) continue;
    const missing = EXPECTED_ORDER.slice(fromIndex + 1, toIndex).map(bridgeType);
    const highRiskJump = fromNode.type === "event"
      && toNode.type === "action"
      && /突然|立刻|当场|猛地/.test(toNode.text)
      && /杀|跳|背叛|自尽|开枪|引爆|献祭/.test(toNode.text);
    issues.push({
      fromNode,
      toNode,
      missingBridgeTypes: missing,
      severity: highRiskJump ? "blocking" : "warning",
      repairCandidates: missing.map((type) => ({
        type,
        description: bridgeDescription(type, fromNode, toNode),
        insertAfterNodeId: fromNode.id,
      })),
    });
  }
  return issues;
}

function classifyNode(text: string): NarrativeLogicNodeType {
  if (/因此|结果|于是.*(?:失去|获得|导致)|后果|代价/.test(text)) return "consequence";
  if (/决定|选择|打算|不再|宁可|必须/.test(text)) return "decision";
  if (/认为|判断|明白|意识到|猜到|看来/.test(text)) return "belief";
  if (/害怕|愤怒|悲伤|紧张|松了口气|心头/.test(text)) return "emotion";
  if (/看见|听见|闻到|察觉|发现|摸到/.test(text)) return "perception";
  if (/走|跑|抓|推|拔|砍|杀|跳|开枪|引爆|转身|伸手|开口/.test(text)) return "action";
  return "event";
}

function bridgeType(type: NarrativeLogicNodeType): NarrativeBridgeCandidate["type"] {
  if (type === "perception") return "perception";
  if (type === "emotion") return "emotion_transition";
  if (type === "belief") return "belief_change";
  if (type === "decision") return "decision";
  if (type === "event") return "causal_event";
  return "motivation";
}

function bridgeDescription(
  type: NarrativeBridgeCandidate["type"],
  fromNode: NarrativeLogicNode,
  toNode: NarrativeLogicNode,
): string {
  return `在“${clip(fromNode.text)}”与“${clip(toNode.text)}”之间补充${type}，只补足人物为何做出该行动的必要桥梁。`;
}

function clip(value: string): string {
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}

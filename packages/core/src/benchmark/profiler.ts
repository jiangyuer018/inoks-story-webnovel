import { createHash } from "node:crypto";
import { auditHumanFeel } from "../human-feel/index.js";
import type {
  AbstractNarrativeMechanism,
  BenchmarkProfile,
  BenchmarkRole,
  ChapterBenchmarkProfile,
} from "./types.js";
import { segmentBenchmarkChapters, segmentBenchmarkScenes } from "./segmenter.js";

export function buildBenchmarkProfile(params: {
  readonly sourceId: string;
  readonly title: string;
  readonly text: string;
  readonly roles: ReadonlyArray<BenchmarkRole>;
  readonly userProvidedText: boolean;
  readonly prohibitedSourceElements?: ReadonlyArray<string>;
}): BenchmarkProfile {
  if (!params.userProvidedText) {
    throw new Error("Deep benchmark analysis requires text explicitly provided or authorized by the user.");
  }
  const chapters = segmentBenchmarkChapters(params.text);
  const chapterProfiles = chapters.map((chapter) => profileChapter(chapter.chapterNumber, chapter.title, chapter.content));
  const prohibited = unique(params.prohibitedSourceElements ?? []);
  const mechanisms = abstractMechanisms(params.sourceId, chapterProfiles, prohibited);
  return {
    sourceId: params.sourceId,
    title: params.title,
    userProvidedText: true,
    roles: unique(params.roles),
    sourceTextHash: hash(params.text),
    chapterProfiles,
    openingPatterns: inferOpenings(chapters.map((chapter) => chapter.content)),
    pacingProfile: averageRatios(chapterProfiles),
    payoffPatterns: unique(chapterProfiles.flatMap((profile) => profile.payoff ? [profile.payoff.result] : [])),
    emotionPatterns: unique(chapterProfiles.flatMap((profile) => profile.pressureChanges)),
    dialoguePatterns: [`平均对白比例 ${average(chapterProfiles.map((profile) => profile.dialogueRatio)).toFixed(3)}`],
    narrationPatterns: [`平均旁白比例 ${average(chapterProfiles.map((profile) => profile.narrationRatio)).toFixed(3)}`],
    scenePatterns: [`平均场景数 ${average(chapterProfiles.map((profile) => profile.sceneCount)).toFixed(2)}`],
    hookPatterns: unique(chapterProfiles.flatMap((profile) => profile.hook ? [profile.hook.type] : [])),
    volumePatterns: inferVolumePatterns(chapterProfiles),
    extractedMechanisms: mechanisms,
    prohibitedSourceElements: prohibited,
    createdAt: new Date().toISOString(),
  };
}

function profileChapter(chapterNumber: number, title: string, content: string): ChapterBenchmarkProfile {
  const scenes = segmentBenchmarkScenes(content);
  const human = auditHumanFeel(content);
  const characters = Math.max(1, content.length);
  const dialogueChars = (content.match(/[“"][^”"]+[”"]/g) ?? []).join("").length;
  const actionCount = (content.match(/走|跑|抓|拿|推|退|转|抬|放|砍|挡|躲|递|接/g) ?? []).length;
  const thoughtCount = (content.match(/想到|认为|判断|意识到|心里|决定|选择/g) ?? []).length;
  const stateChanges = content.match(/得到|失去|发现|暴露|改变|拒绝|答应|拿到|交出|交给|让开|亮起|受伤|死亡/g) ?? [];
  const reversals = content.match(/却|反而|没想到|原来|竟然|直到这时/g) ?? [];
  const lastSentence = content.split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  return {
    chapterNumber,
    title,
    readerExpectationBefore: chapterNumber === 1 ? ["开篇核心承诺"] : [],
    plannedOrInferredFunctions: inferFunctions(content, stateChanges.length, reversals.length),
    beats: scenes.map((scene) => ({
      function: inferSceneFunction(scene.content),
      pressureChange: inferPressure(scene.content),
      observableChange: extractObservableChange(scene.content),
    })),
    pressureChanges: scenes.map((scene) => inferPressure(scene.content)),
    reversals: unique(reversals),
    payoff: /获得|赢|击败|证明|揭开|公开/.test(content)
      ? { setup: "先前压力或期待", result: extractObservableChange(content) }
      : undefined,
    hook: /？|秘密|门后|来不及|忽然发现|真正的/.test(lastSentence)
      ? { type: "unresolved-question", promise: lastSentence }
      : undefined,
    sceneCount: scenes.length,
    dialogueRatio: round(dialogueChars / characters),
    actionRatio: round(actionCount * 4 / characters),
    thoughtRatio: round(thoughtCount * 4 / characters),
    narrationRatio: round(Math.max(0, characters - dialogueChars) / characters),
    functionalEnvironmentRatio: human.metrics.segmentRatioE ?? 0,
    ornamentalProseRatio: human.metrics.segmentRatioO ?? 0,
    irreversibleChange: extractObservableChange(content),
    readerExpectationAfter: lastSentence ? [lastSentence] : [],
  };
}

function abstractMechanisms(
  sourceId: string,
  profiles: ReadonlyArray<ChapterBenchmarkProfile>,
  prohibited: ReadonlyArray<string>,
): ReadonlyArray<AbstractNarrativeMechanism> {
  const candidates = profiles.filter((profile) =>
    profile.reversals.length > 0
    || profile.payoff
    || profile.irreversibleChange !== "未检测到明确不可逆变化");
  return candidates.slice(0, 12).map((profile, index) => ({
    id: `mechanism-${hash(`${sourceId}:${profile.chapterNumber}:${index}`).slice(0, 24)}`,
    name: profile.payoff ? "压力—主动选择—现实确认" : "信息差—反转—状态变化",
    emotionalFunction: profile.payoff ? "延迟期待后给予现实收益" : "用新证据重构读者判断",
    readerExpectationMechanism: [
      "建立可理解期待",
      ...profile.pressureChanges.slice(0, 2),
      "通过人物主动选择改变局势",
    ],
    requiredRoles: ["承受压力者", "阻力制造者", "结果确认者"],
    requiredBeats: [
      "期待建立",
      "真实阻力生效",
      profile.reversals.length > 0 ? "信息或权力反转" : "主动选择",
      "可观察结果",
      "后续影响",
    ],
    expectedPayoffEffects: [profile.irreversibleChange || "至少一项状态发生不可逆变化"],
    commonFailureModes: ["只复制表面事件", "主角不主动", "只写震惊不写结果"],
    prohibitedSourceDetails: prohibited,
    sourceReferences: [{
      sourceId,
      chapterNumber: profile.chapterNumber,
      evidenceHash: hash(JSON.stringify(profile.beats)),
    }],
    approved: false,
  }));
}

function inferFunctions(content: string, changes: number, reversals: number): string[] {
  return unique([
    changes > 0 ? "改变故事状态" : "铺垫",
    reversals > 0 ? "反转读者判断" : "",
    /冲突|争|打|拒绝|威胁/.test(content) ? "升级压力" : "",
    /秘密|发现|线索|证据/.test(content) ? "释放信息" : "",
  ]);
}

function inferSceneFunction(content: string): string {
  if (/获得|赢|击败|证明|公开|交给|让开/.test(content)) return "兑现期待";
  if (/发现|线索|证据|秘密/.test(content)) return "释放信息";
  if (/拒绝|威胁|争|打|阻止/.test(content)) return "升级冲突";
  return "推进人物目标";
}

function inferPressure(content: string): string {
  if (/失去|受伤|死亡|失败|被困|威胁/.test(content)) return "压力上升";
  if (/获得|脱险|赢|击败|解决/.test(content)) return "压力释放";
  return "压力维持";
}

function extractObservableChange(content: string): string {
  const sentences = content.split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean);
  return sentences.reverse().find((sentence) =>
    /得到|获得|失去|发现|暴露|改变|拒绝|答应|拿到|交出|交给|让开|亮起|受伤|死亡|离开|进入/.test(sentence))
    ?? "未检测到明确不可逆变化";
}

function inferOpenings(contents: ReadonlyArray<string>): string[] {
  return unique(contents.slice(0, 5).map((content) => {
    const first = content.split(/[。！？!?]/)[0]?.trim() ?? "";
    if (/对话|“/.test(first)) return "对白入场";
    if (/跑|抓|推|砍|敲|冲/.test(first)) return "动作入场";
    if (/发现|收到|失去|死亡/.test(first)) return "事件入场";
    return "状态入场";
  }));
}

function averageRatios(profiles: ReadonlyArray<ChapterBenchmarkProfile>): Record<string, number> {
  return {
    dialogueRatio: round(average(profiles.map((profile) => profile.dialogueRatio))),
    actionRatio: round(average(profiles.map((profile) => profile.actionRatio))),
    thoughtRatio: round(average(profiles.map((profile) => profile.thoughtRatio))),
    narrationRatio: round(average(profiles.map((profile) => profile.narrationRatio))),
    sceneCount: round(average(profiles.map((profile) => profile.sceneCount))),
  };
}

function inferVolumePatterns(profiles: ReadonlyArray<ChapterBenchmarkProfile>): string[] {
  if (profiles.length < 5) return ["样本不足以推断卷级模式"];
  return ["承诺建立 → 阻力升级 → 中段反转 → 高潮兑现 → 新承诺"];
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function unique<T>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values.filter(Boolean))];
}

function average(values: ReadonlyArray<number>): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

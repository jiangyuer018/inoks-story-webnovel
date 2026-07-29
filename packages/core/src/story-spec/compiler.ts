import { canonicalJson, sha256 } from "../story-system/commit.js";
import type { Platform } from "../models/book.js";
import {
  constitutionConstraints,
  constitutionPromptRules,
  loadStoryConstitution,
} from "./constitution-loader.js";
import type {
  ChapterSpec,
  CompiledWritingContract,
  PlatformProfile,
  StoryConstraint,
  StoryConstraintSet,
} from "./types.js";
import type {
  CanonicalEvent,
  DynamicPlotState,
  EmotionTrajectory,
  PsychologyState,
} from "../narrative-research/types.js";
import type { PayoffEntry, ReaderContract } from "../story-craft/index.js";
import type { AbstractNarrativeMechanism } from "../benchmark/types.js";

const PLATFORM_PROFILES: Readonly<Record<"fanqie" | "qidian", PlatformProfile>> = {
  fanqie: {
    id: "fanqie",
    targetChapterChars: { min: 1_800, preferred: 2_500, max: 3_800 },
    openingPromiseWindow: 1,
    openingPayoffWindow: 3,
    minorPayoffInterval: 3,
    majorPayoffInterval: 18,
    setupTolerance: 0.35,
    hookDensity: 0.8,
    expositionTolerance: 0.18,
    sceneTurnDensity: 0.65,
  },
  qidian: {
    id: "qidian",
    targetChapterChars: { min: 2_000, preferred: 3_000, max: 5_000 },
    openingPromiseWindow: 2,
    openingPayoffWindow: 5,
    minorPayoffInterval: 5,
    majorPayoffInterval: 25,
    setupTolerance: 0.5,
    hookDensity: 0.6,
    expositionTolerance: 0.24,
    sceneTurnDensity: 0.5,
  },
};

export function resolvePlatformProfile(platform: Platform): PlatformProfile {
  return platform === "qidian" ? PLATFORM_PROFILES.qidian : PLATFORM_PROFILES.fanqie;
}

export async function compileWritingContract(params: {
  readonly bookDir: string;
  readonly platform: Platform;
  readonly chapterSpec: ChapterSpec;
  readonly readerContract?: ReaderContract;
  readonly payoffTargets?: ReadonlyArray<PayoffEntry>;
  readonly benchmarkGuidance?: ReadonlyArray<AbstractNarrativeMechanism>;
  readonly inheritedConstraints?: Partial<StoryConstraintSet>;
  readonly proseRules?: ReadonlyArray<string>;
  readonly emotionalTrajectory?: EmotionTrajectory;
  readonly dynamicPlotState?: DynamicPlotState;
  readonly characterStates?: ReadonlyArray<PsychologyState>;
  readonly relevantEventGraph?: ReadonlyArray<CanonicalEvent>;
}): Promise<CompiledWritingContract> {
  const constitution = await loadStoryConstitution(params.bookDir);
  const constraints = mergeConstraintSets(
    constitutionConstraints(),
    params.inheritedConstraints ?? {},
    constraintsFromChapter(params.chapterSpec),
  );
  const compiledAt = new Date().toISOString();
  const basis = {
    constraints,
    platformProfile: resolvePlatformProfile(params.platform),
    readerContract: params.readerContract ?? emptyReaderContract(compiledAt),
    benchmarkGuidance: params.benchmarkGuidance ?? [],
    payoffTargets: params.payoffTargets ?? [],
    chapterSpec: params.chapterSpec,
    sceneContracts: params.chapterSpec.sceneContracts,
    activeBeatContracts: params.chapterSpec.beats.filter((beat) => beat.status === "active" || beat.status === "pending"),
    emotionalTrajectory: params.emotionalTrajectory,
    dynamicPlotState: params.dynamicPlotState,
    characterStates: params.characterStates ?? [],
    relevantEventGraph: params.relevantEventGraph ?? [],
    forbiddenChanges: params.chapterSpec.hardConstraints,
    proseRules: params.proseRules ?? [],
  };
  return {
    constitution: constitutionPromptRules(constitution),
    ...basis,
    compiledAt,
    sourceHash: sha256(canonicalJson({ constitution, ...basis })),
  };
}

function emptyReaderContract(updatedAt: string): ReaderContract {
  return {
    coreFantasy: [],
    emotionalPromises: [],
    progressionPromises: [],
    relationshipPromises: [],
    mysteryPromises: [],
    identityPromises: [],
    forbiddenBetrayals: [],
    version: 1,
    updatedAt,
  };
}

export function renderCompiledWritingContract(contract: CompiledWritingContract): string {
  return [
    "## Story Constitution（不可覆盖）",
    ...contract.constitution.map((rule) => `- ${rule}`),
    "",
    "## Chapter Spec",
    `- spec: ${contract.chapterSpec.id}@${contract.chapterSpec.version}`,
    `- goal: ${contract.chapterSpec.chapterGoal}`,
    `- pov: ${contract.chapterSpec.pov || "按当前大纲"}`,
    `- required state changes: ${contract.chapterSpec.requiredStateChanges.join("；") || "至少一项可观察变化"}`,
    "",
    "## Reader Contract",
    `- core fantasy: ${contract.readerContract.coreFantasy.join("；") || "按 Book Spec"}`,
    `- progression promises: ${contract.readerContract.progressionPromises.join("；") || "无显式条目"}`,
    `- relationship promises: ${contract.readerContract.relationshipPromises.join("；") || "无显式条目"}`,
    `- mystery promises: ${contract.readerContract.mysteryPromises.join("；") || "无显式条目"}`,
    `- forbidden betrayals: ${contract.readerContract.forbiddenBetrayals.join("；") || "不得无因背叛已建立承诺"}`,
    ...(contract.payoffTargets.length > 0 ? [
      "",
      "## Due Payoff Targets",
      ...contract.payoffTargets.map((target) =>
        `- ${target.id}: ${target.promise}；窗口=${target.targetWindow.from}-${target.targetWindow.to}；状态=${target.status}`),
    ] : []),
    ...(contract.benchmarkGuidance.length > 0 ? [
      "",
      "## Approved Benchmark Mechanisms（只迁移机制）",
      ...contract.benchmarkGuidance.map((mechanism) =>
        `- ${mechanism.name}: ${mechanism.requiredBeats.join(" → ")}；禁止复用=${mechanism.prohibitedSourceDetails.join("、") || "任何来源专有细节"}`),
    ] : []),
    "",
    "## Hard Constraints",
    ...contract.constraints.hard.map((constraint) => `- [${constraint.id}] ${constraint.text}`),
    "",
    "## Active Beat Contracts",
    ...contract.activeBeatContracts.map((beat) =>
      `- [${beat.strength}] ${beat.id}: ${beat.function}；验收=${beat.completionCriteria.join("/") || "场内可观察后果"}`),
    ...(contract.emotionalTrajectory ? [
      "",
      "## Target Emotion Trajectory",
      ...contract.emotionalTrajectory.nodes.map((node) =>
        `- ${node.order}. ${node.emotion}(${node.intensity}) → ${node.beliefState} → ${node.behavioralEffect}`),
    ] : []),
    "",
    "## Scene Contracts",
    ...contract.sceneContracts.flatMap((scene) => [
      `### ${scene.id}`,
      `目标：${scene.immediateGoal}`,
      `阻力：${scene.oppositionGoal}`,
      `转折：${scene.turningPoint}`,
      `抉择：${scene.decisionPoint}`,
      `不可逆变化：${scene.irreversibleChange}`,
      `叙事功能：${scene.narrativeFunctions.join("、")}`,
    ]),
    ...(contract.dynamicPlotState ? [
      "",
      "## Dynamic Plot State",
      `- active goals: ${contract.dynamicPlotState.currentGoals.map((item) => `${item.characterId}:${item.goal}`).join("；") || "无"}`,
      `- active conflicts: ${contract.dynamicPlotState.activeConflicts.map((item) => `${item.id}:${item.stakes}`).join("；") || "无"}`,
      `- unresolved decisions: ${contract.dynamicPlotState.unresolvedDecisions.map((item) => item.decision).join("；") || "无"}`,
      `- immediate threats: ${contract.dynamicPlotState.immediateThreats.map((item) => item.description).join("；") || "无"}`,
    ] : []),
    "",
    "只在 Open Space 内自由发挥；不得用章末总结冒充 Beat 兑现。",
  ].join("\n");
}

function mergeConstraintSets(
  ...sets: ReadonlyArray<Partial<StoryConstraintSet>>
): StoryConstraintSet {
  const merge = (key: keyof StoryConstraintSet): ReadonlyArray<StoryConstraint> => {
    const byId = new Map<string, StoryConstraint>();
    for (const set of sets) {
      for (const constraint of set[key] ?? []) byId.set(constraint.id, constraint);
    }
    return [...byId.values()];
  };
  return { hard: merge("hard"), soft: merge("soft"), open: merge("open") };
}

function constraintsFromChapter(spec: ChapterSpec): StoryConstraintSet {
  return {
    hard: spec.hardConstraints.map((text, index) => ({
      id: `chapter.${spec.chapterNumber}.hard.${index + 1}`,
      text,
      source: `${spec.id}@${spec.version}`,
      strength: "hard",
    })),
    soft: spec.softTargets.map((text, index) => ({
      id: `chapter.${spec.chapterNumber}.soft.${index + 1}`,
      text,
      source: `${spec.id}@${spec.version}`,
      strength: "soft",
    })),
    open: spec.openSpace.map((text, index) => ({
      id: `chapter.${spec.chapterNumber}.open.${index + 1}`,
      text,
      source: `${spec.id}@${spec.version}`,
      strength: "open",
    })),
  };
}

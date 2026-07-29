import type {
  CanonicalEvent,
  DynamicPlotState,
  EmotionTrajectory,
  PsychologyState,
} from "../narrative-research/types.js";
import type { PayoffEntry, ReaderContract } from "../story-craft/index.js";
import type { AbstractNarrativeMechanism } from "../benchmark/types.js";

export type StoryConstraintStrength = "hard" | "soft" | "open";
export type StorySpecStatus = "draft" | "approved" | "stale" | "superseded";

export interface StoryConstraint {
  readonly id: string;
  readonly text: string;
  readonly source: string;
  readonly strength: StoryConstraintStrength;
}

export interface StoryConstraintSet {
  readonly hard: ReadonlyArray<StoryConstraint>;
  readonly soft: ReadonlyArray<StoryConstraint>;
  readonly open: ReadonlyArray<StoryConstraint>;
}

export interface ControlledNarrativeBeat {
  readonly id: string;
  readonly parentId: string;
  readonly function: string;
  readonly requiredInputs: ReadonlyArray<string>;
  readonly expectedStateChange: ReadonlyArray<string>;
  readonly completionCriteria: ReadonlyArray<string>;
  readonly strength: StoryConstraintStrength;
  readonly status: "pending" | "active" | "fulfilled" | "failed" | "skipped";
}

export interface CharacterSceneAgenda {
  readonly wants: string;
  readonly fears: string;
  readonly hides: ReadonlyArray<string>;
  readonly cannotSay: ReadonlyArray<string>;
  readonly tactic: string;
  readonly leverage: ReadonlyArray<string>;
  readonly exitCondition: string;
}

export interface SceneState {
  readonly goals: ReadonlyArray<string>;
  readonly relationships: ReadonlyArray<string>;
  readonly risks: ReadonlyArray<string>;
  readonly resources: ReadonlyArray<string>;
  readonly information: ReadonlyArray<string>;
}

export interface SceneContract {
  readonly id: string;
  readonly pov: string;
  readonly immediateGoal: string;
  readonly oppositionGoal: string;
  readonly characterAgendas: Readonly<Record<string, CharacterSceneAgenda>>;
  readonly knownInformation: ReadonlyArray<string>;
  readonly hiddenInformation: ReadonlyArray<string>;
  readonly readerMustLearn: ReadonlyArray<string>;
  readonly readerMustNotKnowYet: ReadonlyArray<string>;
  readonly conflictMethod: string;
  readonly turningPoint: string;
  readonly decisionPoint: string;
  readonly irreversibleChange: string;
  readonly entryState: SceneState;
  readonly exitState: SceneState;
  readonly narrativeFunctions: ReadonlyArray<string>;
  readonly deliveryPreference: {
    readonly dialogue: "low" | "medium" | "high";
    readonly action: "low" | "medium" | "high";
    readonly thought: "low" | "medium" | "high";
    readonly narration: "minimal" | "limited";
  };
  readonly beatIds: ReadonlyArray<string>;
}

export interface InformationDeliveryPlan {
  readonly fact: string;
  readonly readerNeedsNow: boolean;
  readonly characterKnowledgeState: string;
  readonly possibleCarriers: ReadonlyArray<
    "action" | "dialogue" | "object" | "reaction" | "environment" | "thought" | "narration"
  >;
  readonly selectedCarriers: ReadonlyArray<string>;
  readonly dramaticMethod: string;
  readonly narrationAllowed: boolean;
  readonly narrationReason?: string;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly description: string;
  readonly severity: "blocking" | "advisory";
  readonly evidenceTerms: ReadonlyArray<string>;
}

export interface ChapterSpec {
  readonly id: string;
  readonly version: number;
  readonly status: StorySpecStatus;
  readonly bookId: string;
  readonly volumeId: string;
  readonly arcId: string;
  readonly chapterNumber: number;
  readonly pov: string;
  readonly location: string;
  readonly time: string;
  readonly chapterGoal: string;
  readonly readerExpectation: ReadonlyArray<string>;
  readonly emotionalTrajectoryId: string;
  readonly payoffTargets: ReadonlyArray<string>;
  readonly plannedEvents: ReadonlyArray<string>;
  readonly requiredBeats: ReadonlyArray<string>;
  readonly hardConstraints: ReadonlyArray<string>;
  readonly softTargets: ReadonlyArray<string>;
  readonly openSpace: ReadonlyArray<string>;
  readonly requiredStateChanges: ReadonlyArray<string>;
  readonly acceptanceCriteria: ReadonlyArray<AcceptanceCriterion>;
  readonly sceneContracts: ReadonlyArray<SceneContract>;
  readonly beats: ReadonlyArray<ControlledNarrativeBeat>;
  readonly sourceIntentHash: string;
  readonly createdAt: string;
  readonly approvedAt?: string;
}

export interface PlatformProfile {
  readonly id: "fanqie" | "qidian";
  readonly targetChapterChars: {
    readonly min: number;
    readonly preferred: number;
    readonly max: number;
  };
  readonly openingPromiseWindow: number;
  readonly openingPayoffWindow: number;
  readonly minorPayoffInterval: number;
  readonly majorPayoffInterval: number;
  readonly setupTolerance: number;
  readonly hookDensity: number;
  readonly expositionTolerance: number;
  readonly sceneTurnDensity: number;
}

export interface CompiledWritingContract {
  readonly constitution: ReadonlyArray<string>;
  readonly constraints: StoryConstraintSet;
  readonly platformProfile: PlatformProfile;
  readonly readerContract: ReaderContract;
  readonly benchmarkGuidance: ReadonlyArray<AbstractNarrativeMechanism>;
  readonly payoffTargets: ReadonlyArray<PayoffEntry>;
  readonly chapterSpec: ChapterSpec;
  readonly sceneContracts: ReadonlyArray<SceneContract>;
  readonly activeBeatContracts: ReadonlyArray<ControlledNarrativeBeat>;
  readonly emotionalTrajectory?: EmotionTrajectory;
  readonly dynamicPlotState?: DynamicPlotState;
  readonly characterStates: ReadonlyArray<PsychologyState>;
  readonly relevantEventGraph: ReadonlyArray<CanonicalEvent>;
  readonly forbiddenChanges: ReadonlyArray<string>;
  readonly proseRules: ReadonlyArray<string>;
  readonly compiledAt: string;
  readonly sourceHash: string;
}

export interface OutlineControlResult {
  readonly expectedBeatIds: ReadonlyArray<string>;
  readonly fulfilledBeatIds: ReadonlyArray<string>;
  readonly partiallyFulfilledBeatIds: ReadonlyArray<string>;
  readonly missingBeatIds: ReadonlyArray<string>;
  readonly unexpectedStateChanges: ReadonlyArray<string>;
  readonly evidence: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly verdict: "continue" | "repair" | "replan" | "block";
}

export interface StoryConvergenceCheck {
  readonly gate: string;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly details: ReadonlyArray<string>;
}

export interface StoryConvergenceResult {
  readonly passed: boolean;
  readonly checks: ReadonlyArray<StoryConvergenceCheck>;
  readonly blockingReasons: ReadonlyArray<string>;
  readonly contentHash: string;
  readonly specId: string;
  readonly specVersion: number;
  readonly createdAt: string;
}

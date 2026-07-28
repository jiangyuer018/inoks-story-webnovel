import type { ControlledNarrativeBeat } from "../story-spec/types.js";

export interface NarrativeConcretenessScore {
  readonly eventId: string;
  readonly narrativeImportance: number;
  readonly plannedDetailLevel: number;
  readonly actualDetailLevel: number;
  readonly plannedSceneCount: number;
  readonly actualSceneCount: number;
  readonly plannedCharBudget: number;
  readonly actualCharCount: number;
  readonly underExpanded: boolean;
  readonly overExpanded: boolean;
}

export interface PlannedStoryEvent {
  readonly id: string;
  readonly type: string;
  readonly actors: ReadonlyArray<string>;
  readonly targetEntities: ReadonlyArray<string>;
  readonly causes: ReadonlyArray<string>;
  readonly prerequisites: ReadonlyArray<string>;
  readonly expectedEffects: ReadonlyArray<string>;
  readonly allocatedChapter: number;
  readonly allocatedSceneIds: ReadonlyArray<string>;
  readonly importance: number;
  readonly concretenessTarget: number;
}

export interface EntityRef {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
}

export interface CanonicalStateChange {
  readonly subject: EntityRef;
  readonly predicate: string;
  readonly oldValue?: unknown;
  readonly newValue: unknown;
}

export interface TemporalReference {
  readonly chapter: number;
  readonly order?: number;
  readonly label?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}

export interface EventProvenance {
  readonly sourceChapter: number;
  readonly sourceCommitId: string;
  readonly sourceEventId?: string;
  readonly evidence: ReadonlyArray<string>;
}

export interface CanonicalEvent {
  readonly id: string;
  readonly commitId: string;
  readonly subject: EntityRef;
  readonly predicate: string;
  readonly object?: EntityRef;
  readonly actorGoal?: string;
  readonly causeEventIds: ReadonlyArray<string>;
  readonly prerequisiteEventIds: ReadonlyArray<string>;
  readonly consequenceEventIds: ReadonlyArray<string>;
  readonly stateChanges: ReadonlyArray<CanonicalStateChange>;
  readonly enables: ReadonlyArray<string>;
  readonly blocks: ReadonlyArray<string>;
  readonly time: TemporalReference;
  readonly location?: EntityRef;
  readonly certainty: "objective" | "subjective" | "claimed" | "rumored";
  readonly provenance: EventProvenance;
}

export interface EmotionTrajectoryNode {
  readonly order: number;
  readonly emotion: string;
  readonly intensity: number;
  readonly triggerEventId?: string;
  readonly beliefState: string;
  readonly behavioralEffect: string;
  readonly expectedDecisionChange?: string;
}

export interface EmotionTrajectory {
  readonly id: string;
  readonly ownerCharacterId: string;
  readonly scope: "scene" | "chapter" | "arc" | "volume";
  readonly nodes: ReadonlyArray<EmotionTrajectoryNode>;
}

export interface PsychologyState {
  readonly characterId: string;
  readonly desire: string;
  readonly fear: string;
  readonly belief: string;
  readonly selfImage: string;
  readonly relationshipBeliefs: Readonly<Record<string, string>>;
  readonly emotionalPressure: ReadonlyArray<string>;
  readonly copingStrategy: string;
  readonly contradiction: string;
}

export type NarrativeLogicNodeType =
  | "event"
  | "perception"
  | "emotion"
  | "belief"
  | "decision"
  | "action"
  | "consequence";

export interface NarrativeLogicNode {
  readonly id: string;
  readonly type: NarrativeLogicNodeType;
  readonly text: string;
  readonly characterId?: string;
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
}

export interface NarrativeBridgeCandidate {
  readonly type:
    | "perception"
    | "belief_change"
    | "emotion_transition"
    | "risk_assessment"
    | "decision"
    | "motivation"
    | "causal_event";
  readonly description: string;
  readonly insertAfterNodeId: string;
}

export interface MissingNarrativeLogicIssue {
  readonly fromNode: NarrativeLogicNode;
  readonly toNode: NarrativeLogicNode;
  readonly missingBridgeTypes: ReadonlyArray<NarrativeBridgeCandidate["type"]>;
  readonly severity: "info" | "warning" | "blocking";
  readonly repairCandidates: ReadonlyArray<NarrativeBridgeCandidate>;
}

export interface CharacterGoalState {
  readonly characterId: string;
  readonly goal: string;
  readonly status: "active" | "blocked" | "achieved" | "abandoned";
}

export interface ConflictState {
  readonly id: string;
  readonly parties: ReadonlyArray<string>;
  readonly stakes: string;
  readonly pressure: number;
}

export interface DecisionDebt {
  readonly id: string;
  readonly characterId: string;
  readonly decision: string;
  readonly dueChapter?: number;
}

export interface PowerRelation {
  readonly from: string;
  readonly to: string;
  readonly advantage: string;
  readonly strength: number;
}

export interface ResourceState {
  readonly id: string;
  readonly owner: string;
  readonly state: string;
}

export interface ThreatState {
  readonly id: string;
  readonly target: string;
  readonly description: string;
  readonly urgency: number;
}

export interface DynamicPlotState {
  readonly currentGoals: ReadonlyArray<CharacterGoalState>;
  readonly activeConflicts: ReadonlyArray<ConflictState>;
  readonly unresolvedDecisions: ReadonlyArray<DecisionDebt>;
  readonly currentPowerRelations: ReadonlyArray<PowerRelation>;
  readonly availableResources: ReadonlyArray<ResourceState>;
  readonly immediateThreats: ReadonlyArray<ThreatState>;
  readonly activeReaderExpectations: ReadonlyArray<string>;
}

export interface ContextWeight {
  readonly sourceId: string;
  readonly scope: "scene" | "chapter" | "arc" | "volume" | "book" | "history";
  readonly relevance: number;
  readonly recency: number;
  readonly authority: number;
  readonly requiredForCorrectness: boolean;
}

export interface WeightedContextItem {
  readonly weight: ContextWeight;
  readonly content: string;
  readonly estimatedTokens?: number;
}

export interface OutlineChange {
  readonly specId: string;
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

export interface DynamicOutlineRevision {
  readonly id: string;
  readonly bookId: string;
  readonly triggeredByCommitId: string;
  readonly affectedSpecIds: ReadonlyArray<string>;
  readonly proposedChanges: ReadonlyArray<OutlineChange>;
  readonly reasons: ReadonlyArray<string>;
  readonly requiresHumanApproval: boolean;
  readonly status: "proposed" | "approved" | "rejected" | "applied";
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface OutlineControlInput {
  readonly content: string;
  readonly beats: ReadonlyArray<ControlledNarrativeBeat>;
  readonly actualStateChanges?: ReadonlyArray<string>;
  readonly allowedStateChanges?: ReadonlyArray<string>;
}

export interface TemporalFact {
  readonly id: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly chapter: number;
  readonly order: number;
  readonly validUntilChapter?: number;
  readonly sourceEventId: string;
}

export interface TemporalConflict {
  readonly code: string;
  readonly severity: "warning" | "blocking";
  readonly subjectId: string;
  readonly message: string;
  readonly factIds: ReadonlyArray<string>;
}

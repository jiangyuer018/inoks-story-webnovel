export interface PlaceholderDetectionResult {
  readonly placeholders: ReadonlyArray<string>;
  readonly missingFields: ReadonlyArray<string>;
  readonly verdict: "pass" | "block";
}

export type InformationCarrier =
  | "dialogue"
  | "action"
  | "object"
  | "reaction"
  | "observation"
  | "thought"
  | "environment"
  | "narration";

export type NarrationReason =
  | "time-compression"
  | "location-transition"
  | "minimum-background"
  | "causal-clarification"
  | "reader-comprehension-repair";

export interface RealizationSceneState {
  readonly goals: ReadonlyArray<string>;
  readonly relationships: ReadonlyArray<string>;
  readonly risks: ReadonlyArray<string>;
  readonly resources: ReadonlyArray<string>;
  readonly information: ReadonlyArray<string>;
}

export interface RealizedScenePlan {
  readonly id: string;
  readonly chapterNumber: number;
  readonly order: number;
  readonly location: string;
  readonly time: string;
  readonly povCharacterId: string;
  readonly cast: ReadonlyArray<string>;
  readonly immediateGoal: string;
  readonly oppositionGoal: string;
  readonly stakes: string;
  readonly entryState: RealizationSceneState;
  readonly exitState: RealizationSceneState;
  readonly turningPoint: string;
  readonly decisionPoint: string;
  readonly irreversibleChange: string;
  readonly narrativeFunctions: ReadonlyArray<string>;
  readonly beatIds: ReadonlyArray<string>;
  readonly status: "generated" | "approved" | "writing" | "review" | "repair" | "passed";
}

export interface CharacterAgenda {
  readonly characterId: string;
  readonly wantsNow: string;
  readonly fearsNow: string;
  readonly hides: ReadonlyArray<string>;
  readonly cannotSayDirectly: ReadonlyArray<string>;
  readonly beliefAboutOthers: Readonly<Record<string, string>>;
  readonly tactic: string;
  readonly leverage: ReadonlyArray<string>;
  readonly successCondition: string;
  readonly retreatCondition: string;
  readonly knowledgeBoundary: {
    readonly knows: ReadonlyArray<string>;
    readonly doesNotKnow: ReadonlyArray<string>;
    readonly falselyBelieves: ReadonlyArray<string>;
  };
}

export interface InformationUnit {
  readonly id: string;
  readonly fact: string;
  readonly readerNeedsNow: boolean;
  readonly whoKnows: ReadonlyArray<string>;
  readonly whoDoesNotKnow: ReadonlyArray<string>;
  readonly whoWantsToHideIt: ReadonlyArray<string>;
  readonly possibleCarriers: ReadonlyArray<InformationCarrier>;
  readonly selectedCarriers: ReadonlyArray<InformationCarrier>;
  readonly deliveryMethod: string;
  readonly deliveryEvent: string;
  readonly consequence: string;
  readonly narrationAllowed: boolean;
  readonly narrationReason?: NarrationReason;
}

export interface NarrationPermission {
  readonly informationUnitId: string;
  readonly reason: NarrationReason;
  readonly maximumChars: number;
  readonly requiredContent: string;
  readonly forbiddenContent: ReadonlyArray<string>;
}

export interface InteractionTurn {
  readonly order: number;
  readonly initiator: string;
  readonly stimulus: string;
  readonly responder: string;
  readonly immediateReaction: string;
  readonly interpretation: string;
  readonly strategyBefore: string;
  readonly strategyAfter: string;
  readonly outwardActionOrDialogue: string;
  readonly effectOnOtherCharacter: string;
  readonly informationRevealed: ReadonlyArray<string>;
  readonly informationHidden: ReadonlyArray<string>;
  readonly stateChange?: string;
}

export interface EventConcretenessPlan {
  readonly eventId: string;
  readonly importance: number;
  readonly emotionalValue: number;
  readonly irreversibility: number;
  readonly plannedSceneCount: number;
  readonly plannedCharBudget: number;
  readonly allowedCompression: boolean;
}

export interface RealizedScene {
  readonly plan: RealizedScenePlan;
  readonly characterAgendas: ReadonlyArray<CharacterAgenda>;
  readonly informationUnits: ReadonlyArray<InformationUnit>;
  readonly interactionTurns: ReadonlyArray<InteractionTurn>;
  readonly narrationPermissions: ReadonlyArray<NarrationPermission>;
}

export interface SceneRealizationBundle {
  readonly schemaVersion: "1.0";
  readonly chapterNumber: number;
  readonly chapterGoal: string;
  readonly scenes: ReadonlyArray<RealizedScene>;
  readonly concretenessPlan: ReadonlyArray<EventConcretenessPlan>;
  readonly createdAt: string;
  readonly sourceHash: string;
  readonly tokenUsage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface SceneReviewIssue {
  readonly id: string;
  readonly severity: "blocking" | "advisory";
  readonly message: string;
  readonly excerpt: string;
}

export interface SemanticSceneReview {
  readonly sceneId: string;
  readonly narrationUnits: ReadonlyArray<{
    readonly excerpt: string;
    readonly information: string;
    readonly necessary: boolean;
    readonly permissionMatched: boolean;
    readonly replacementCarrier?: InformationCarrier;
  }>;
  readonly dialogueTurns: ReadonlyArray<{
    readonly excerpt: string;
    readonly speaker: string;
    readonly speakerGoal: string | null;
    readonly respondsToPreviousTurn: boolean;
    readonly changesInteraction: boolean;
    readonly informationDump: boolean;
    readonly violatesKnowledgeBoundary: boolean;
  }>;
  readonly actions: ReadonlyArray<{
    readonly excerpt: string;
    readonly intention: string | null;
    readonly observableEffect: string | null;
    readonly removableWithoutLoss: boolean;
  }>;
  readonly thoughts: ReadonlyArray<{
    readonly excerpt: string;
    readonly observation: string | null;
    readonly interpretation: string | null;
    readonly beliefChange: string | null;
    readonly strategyChange: string | null;
    readonly decisionChange: string | null;
  }>;
  readonly environmentDetails: ReadonlyArray<{
    readonly excerpt: string;
    readonly narrativeFunction: string | null;
    readonly affectsAction: boolean;
    readonly affectsRisk: boolean;
    readonly carriesClue: boolean;
    readonly necessaryAtmosphere: boolean;
    readonly removableWithoutLoss: boolean;
  }>;
  readonly informationFulfillment: ReadonlyArray<{
    readonly informationUnitId: string;
    readonly delivered: boolean;
    readonly carrierUsed: ReadonlyArray<InformationCarrier>;
    readonly consequenceVisible: boolean;
  }>;
  readonly interactionFulfillment: ReadonlyArray<{
    readonly turnOrder: number;
    readonly fulfilled: boolean;
    readonly missingParts: ReadonlyArray<string>;
  }>;
  readonly entryExitStateMatch: boolean;
  readonly unintendedFacts: ReadonlyArray<SceneReviewIssue>;
  readonly missingDramatization: ReadonlyArray<SceneReviewIssue>;
  readonly verdict: "pass" | "repair" | "block";
}

export interface SceneRepairInput {
  readonly originalScene: string;
  readonly scenePlan: RealizedScenePlan;
  readonly characterAgendas: ReadonlyArray<CharacterAgenda>;
  readonly informationUnits: ReadonlyArray<InformationUnit>;
  readonly interactionTurns: ReadonlyArray<InteractionTurn>;
  readonly narrationPermissions: ReadonlyArray<NarrationPermission>;
  readonly review: SemanticSceneReview;
  readonly immutableFacts: ReadonlyArray<string>;
  readonly allowedChanges: ReadonlyArray<string>;
}

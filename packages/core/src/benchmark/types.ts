export type BenchmarkRole =
  | "primary"
  | "opening"
  | "structure"
  | "pacing"
  | "payoff"
  | "emotion"
  | "dialogue"
  | "human-feel"
  | "prose";

export interface SourceReference {
  readonly sourceId: string;
  readonly chapterNumber?: number;
  readonly sceneIndex?: number;
  readonly evidenceHash: string;
}

export interface AbstractNarrativeMechanism {
  readonly id: string;
  readonly name: string;
  readonly emotionalFunction: string;
  readonly readerExpectationMechanism: ReadonlyArray<string>;
  readonly requiredRoles: ReadonlyArray<string>;
  readonly requiredBeats: ReadonlyArray<string>;
  readonly expectedPayoffEffects: ReadonlyArray<string>;
  readonly commonFailureModes: ReadonlyArray<string>;
  readonly prohibitedSourceDetails: ReadonlyArray<string>;
  readonly sourceReferences: ReadonlyArray<SourceReference>;
  readonly approved: boolean;
}

export interface NarrativeBeat {
  readonly function: string;
  readonly pressureChange: string;
  readonly observableChange: string;
}

export interface ChapterBenchmarkProfile {
  readonly chapterNumber: number;
  readonly title: string;
  readonly readerExpectationBefore: ReadonlyArray<string>;
  readonly plannedOrInferredFunctions: ReadonlyArray<string>;
  readonly beats: ReadonlyArray<NarrativeBeat>;
  readonly pressureChanges: ReadonlyArray<string>;
  readonly reversals: ReadonlyArray<string>;
  readonly payoff?: { readonly setup: string; readonly result: string };
  readonly hook?: { readonly type: string; readonly promise: string };
  readonly sceneCount: number;
  readonly dialogueRatio: number;
  readonly actionRatio: number;
  readonly thoughtRatio: number;
  readonly narrationRatio: number;
  readonly functionalEnvironmentRatio: number;
  readonly ornamentalProseRatio: number;
  readonly irreversibleChange: string;
  readonly readerExpectationAfter: ReadonlyArray<string>;
}

/**
 * An abstract, source-text-free description of how narrative information is
 * carried. This is the only style-learning payload that may be exposed to a
 * Writer. It intentionally contains no excerpts, names, or source entities.
 */
export interface NarrativeDeliveryProfile {
  readonly dialogueInformationRatio: number;
  readonly actionInformationRatio: number;
  readonly objectInformationRatio: number;
  readonly narrationInformationRatio: number;
  readonly averageInteractionTurns: number;
  readonly reactionCouplingScore: number;
  readonly thoughtToDecisionRate: number;
  readonly functionalEnvironmentRate: number;
  readonly explanatoryNarrationRate: number;
  readonly commonDialogueTactics: ReadonlyArray<string>;
  readonly commonOmissionStrategies: ReadonlyArray<string>;
  readonly commonSceneEntryMethods: ReadonlyArray<string>;
  readonly commonSceneExitMethods: ReadonlyArray<string>;
}

/** Stored inside the isolated benchmark profile and never rendered to Writer. */
export interface BenchmarkStructureSignature {
  readonly eventSequence: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
  readonly relationships: ReadonlyArray<string>;
  readonly sceneFunctions: ReadonlyArray<string>;
  readonly beatSequence: ReadonlyArray<string>;
}

/** The candidate-side structure available before formal fact extraction. */
export interface StructuredSimilarityInput {
  readonly text: string;
  readonly eventSequence: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
  readonly relationships: ReadonlyArray<string>;
  readonly sceneFunctions: ReadonlyArray<string>;
  readonly beatSequence: ReadonlyArray<string>;
}

export interface BenchmarkProfile {
  readonly sourceId: string;
  readonly title: string;
  readonly userProvidedText: true;
  readonly roles: ReadonlyArray<BenchmarkRole>;
  readonly sourceTextHash: string;
  readonly chapterProfiles: ReadonlyArray<ChapterBenchmarkProfile>;
  readonly deliveryProfile: NarrativeDeliveryProfile;
  readonly structureSignature: BenchmarkStructureSignature;
  readonly openingPatterns: ReadonlyArray<string>;
  readonly pacingProfile: Readonly<Record<string, number>>;
  readonly payoffPatterns: ReadonlyArray<string>;
  readonly emotionPatterns: ReadonlyArray<string>;
  readonly dialoguePatterns: ReadonlyArray<string>;
  readonly narrationPatterns: ReadonlyArray<string>;
  readonly scenePatterns: ReadonlyArray<string>;
  readonly hookPatterns: ReadonlyArray<string>;
  readonly volumePatterns: ReadonlyArray<string>;
  readonly extractedMechanisms: ReadonlyArray<AbstractNarrativeMechanism>;
  readonly prohibitedSourceElements: ReadonlyArray<string>;
  readonly createdAt: string;
}

export interface SimilarityFlag {
  readonly candidateExcerpt: string;
  readonly sourceExcerpt: string;
  readonly start: number;
  readonly end: number;
  readonly reason: string;
}

export interface SimilarityReport {
  readonly mechanismSimilarity: number;
  readonly expressionSimilarity: number;
  readonly plotSequenceSimilarity: number;
  readonly entitySimilarity: number;
  readonly settingSimilarity: number;
  readonly relationshipSimilarity: number;
  readonly sceneFunctionSimilarity: number;
  readonly beatSequenceSimilarity: number;
  readonly structuralSimilarity: number;
  readonly structureEvidence: ReadonlyArray<string>;
  readonly flaggedPassages: ReadonlyArray<SimilarityFlag>;
  readonly verdict: "pass" | "review" | "block";
  readonly comparedSourceIds: ReadonlyArray<string>;
}

export interface PublicRankingEntry {
  readonly rank: number;
  readonly title: string;
  readonly author?: string;
  readonly tags: ReadonlyArray<string>;
  readonly synopsis?: string;
  readonly wordCount?: number;
  readonly serialStatus?: string;
  readonly publicUrl?: string;
}

export interface PublicMarketSnapshot {
  readonly platform: "fanqie" | "qidian";
  readonly listName: string;
  readonly capturedAt: string;
  readonly entries: ReadonlyArray<PublicRankingEntry>;
  readonly sourcePolicy: "public-metadata-only";
}

export interface BenchmarkVariant {
  readonly id: string;
  readonly mechanismId: string;
  readonly scene: string;
  readonly conflictSource: string;
  readonly relationshipStructure: string;
  readonly solutionMethod: string;
  readonly witnessStructure: string;
  readonly reward: string;
  readonly cost: string;
  readonly followUpImpact: string;
}

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

export interface BenchmarkProfile {
  readonly sourceId: string;
  readonly title: string;
  readonly userProvidedText: true;
  readonly roles: ReadonlyArray<BenchmarkRole>;
  readonly sourceTextHash: string;
  readonly chapterProfiles: ReadonlyArray<ChapterBenchmarkProfile>;
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

import type { RuntimeStateDelta } from "../models/runtime-state.js";

export const STORY_EVENT_TYPES = [
  "entity_created",
  "entity_renamed",
  "entity_state_changed",
  "relationship_created",
  "relationship_changed",
  "relationship_ended",
  "location_changed",
  "item_acquired",
  "item_lost",
  "knowledge_gained",
  "knowledge_corrected",
  "world_rule_revealed",
  "world_rule_broken",
  "timeline_event",
  "open_loop_created",
  "open_loop_advanced",
  "open_loop_closed",
  "reader_promise_created",
  "reader_promise_paid_off",
  "character_entered",
  "character_exited",
] as const;

export type KnownStoryEventType = typeof STORY_EVENT_TYPES[number];
export type EpistemicStatus = "objective" | "character-belief" | "rumor" | "lie" | "hypothesis" | "dream" | "plan";
export type ProjectionStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface StoryEvent {
  readonly eventId: string;
  readonly chapter: number;
  readonly eventType: string;
  readonly subject: string;
  readonly object?: string;
  readonly payload: Record<string, unknown>;
  readonly evidence: ReadonlyArray<string>;
  readonly confidence: number;
  readonly epistemicStatus: EpistemicStatus;
  readonly sourceExcerpt: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface StateDelta {
  readonly subject: string;
  readonly predicate: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly sourceEventId?: string;
}

export interface EntityDelta {
  readonly entityId: string;
  readonly operation: "create" | "rename" | "merge" | "split" | "update";
  readonly canonicalName: string;
  readonly entityType: string;
  readonly aliases: ReadonlyArray<string>;
  readonly payload: Record<string, unknown>;
}

export interface RelationshipDelta {
  readonly fromEntity: string;
  readonly toEntity: string;
  readonly relationshipType: string;
  readonly operation: "create" | "change" | "end";
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface ChapterSummaryPayload {
  readonly chapter: number;
  readonly title: string;
  readonly characters: string;
  readonly events: string;
  readonly stateChanges: string;
  readonly hookActivity: string;
  readonly mood: string;
  readonly chapterType: string;
  readonly text: string;
}

export interface ChapterCommit {
  readonly schemaVersion: string;
  readonly commitId: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly status: "accepted" | "rejected";
  readonly parentCommitId: string | null;
  readonly previousCommitHash: string | null;
  readonly commitHash: string;
  readonly source: {
    readonly chapterPath: string;
    readonly contentHash: string;
    readonly title: string;
    readonly wordCount: number;
  };
  readonly validation: {
    readonly proseQualityPassed: boolean;
    readonly continuityPassed: boolean;
    readonly fulfillmentPassed: boolean;
    readonly disambiguationPassed: boolean;
    readonly blockingCount: number;
    readonly storyConvergencePassed?: boolean;
    readonly humanFeelPassed?: boolean;
    readonly emotionPassed?: boolean;
    readonly payoffPassed?: boolean;
    readonly structurePassed?: boolean;
    readonly similarityPassed?: boolean;
    readonly temporalPassed?: boolean;
    readonly humanApprovalPassed?: boolean;
  };
  readonly events: ReadonlyArray<StoryEvent>;
  readonly stateDeltas: ReadonlyArray<StateDelta>;
  readonly entityDeltas: ReadonlyArray<EntityDelta>;
  readonly relationshipDeltas: ReadonlyArray<RelationshipDelta>;
  readonly summary: ChapterSummaryPayload;
  readonly provenance: Record<string, unknown>;
  readonly projectionStatus: Record<string, ProjectionStatus>;
  readonly createdAt: string;
}

export interface ChapterFactCandidates {
  readonly acceptedCandidates: ReadonlyArray<StoryEvent>;
  readonly ambiguousCandidates: ReadonlyArray<StoryEvent>;
  readonly rejectedCandidates: ReadonlyArray<StoryEvent>;
}

export interface StoryProjectionResult {
  readonly name: string;
  readonly status: ProjectionStatus;
  readonly durationMs: number;
  readonly error?: string;
  readonly details?: Record<string, unknown>;
}

export interface ChapterCommitProjectionPayload {
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly currentStateMarkdown?: string;
  readonly ledgerMarkdown?: string;
  readonly hooksMarkdown?: string;
  readonly chapterSummariesMarkdown?: string;
  readonly subplotsMarkdown?: string;
  readonly emotionalArcsMarkdown?: string;
  readonly characterMatrixMarkdown?: string;
  readonly runtimeStateSnapshot?: unknown;
}

export interface LongFormMemoryConfig {
  readonly enabled: boolean;
  readonly authority: "chapter-commit";
  readonly strictPreflight: boolean;
  readonly blockOnProjectionFailure: boolean;
  readonly generateSequenceSummaries: boolean;
  readonly sequenceSize: number;
  readonly generateArcSummaries: boolean;
  readonly retrieval: {
    readonly recentChapterCount: number;
    readonly maxHistoricalEvents: number;
    readonly maxRelatedSummaries: number;
    readonly useFts: boolean;
    readonly useEmbeddings: boolean;
    readonly protectedTokenRatio: number;
    readonly retrievedTokenRatio: number;
    readonly compressedTokenRatio: number;
  };
}

export const DEFAULT_LONG_FORM_MEMORY_CONFIG: LongFormMemoryConfig = {
  enabled: true,
  authority: "chapter-commit",
  strictPreflight: true,
  blockOnProjectionFailure: true,
  generateSequenceSummaries: true,
  sequenceSize: 8,
  generateArcSummaries: true,
  retrieval: {
    recentChapterCount: 5,
    maxHistoricalEvents: 20,
    maxRelatedSummaries: 10,
    useFts: true,
    useEmbeddings: false,
    protectedTokenRatio: 0.45,
    retrievedTokenRatio: 0.30,
    compressedTokenRatio: 0.25,
  },
};

export interface MemoryContextPackage {
  readonly protected: {
    readonly currentFacts: ReadonlyArray<unknown>;
    readonly characterKnowledge: ReadonlyArray<unknown>;
    readonly worldRules: ReadonlyArray<unknown>;
    readonly activeHooks: ReadonlyArray<unknown>;
    readonly hardConstraints: ReadonlyArray<string>;
  };
  readonly recent: {
    readonly recentSummaries: ReadonlyArray<unknown>;
  };
  readonly retrieved: {
    readonly historicalEvents: ReadonlyArray<StoryEvent & { readonly relevanceReason: string; readonly sourceCommitId: string }>;
    readonly relatedSummaries: ReadonlyArray<unknown>;
    readonly relationshipHistory: ReadonlyArray<unknown>;
  };
  readonly compressed: {
    readonly arcSummary?: string;
    readonly volumeSummary?: string;
    readonly bookSummary?: string;
  };
  readonly provenance: ReadonlyArray<{
    readonly sourceChapter: number;
    readonly sourceCommitId?: string;
    readonly sourceEventId?: string;
    readonly relevanceReason: string;
  }>;
  readonly diagnostics: {
    readonly tokenBudget: number;
    readonly estimatedTokens: number;
    readonly ftsUsed: boolean;
    readonly embeddingsUsed: boolean;
    readonly degraded: ReadonlyArray<string>;
  };
}

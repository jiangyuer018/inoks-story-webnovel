import { z } from "zod";
import { STORY_EVENT_TYPES } from "./types.js";

export const EpistemicStatusSchema = z.enum([
  "objective",
  "character-belief",
  "rumor",
  "lie",
  "hypothesis",
  "dream",
  "plan",
]);

export const StoryEventSchema = z.object({
  eventId: z.string().min(8),
  chapter: z.number().int().min(1),
  eventType: z.string().min(1),
  subject: z.string().min(1),
  object: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  evidence: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  epistemicStatus: EpistemicStatusSchema.default("objective"),
  sourceExcerpt: z.string().default(""),
  sourceStart: z.number().int().min(0).default(0),
  sourceEnd: z.number().int().min(0).default(0),
}).superRefine((event, context) => {
  if (event.sourceEnd < event.sourceStart) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "sourceEnd must be >= sourceStart" });
  }
  if (!STORY_EVENT_TYPES.includes(event.eventType as typeof STORY_EVENT_TYPES[number])
    && event.epistemicStatus === "objective") {
    const mutatesCore = event.payload.mutatesCoreState === true;
    if (mutatesCore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown event type "${event.eventType}" cannot mutate core state`,
      });
    }
  }
});

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(JsonValueSchema),
]));

export const StateDeltaSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  oldValue: JsonValueSchema,
  newValue: JsonValueSchema,
  sourceEventId: z.string().optional(),
});

export const EntityDeltaSchema = z.object({
  entityId: z.string().min(1),
  operation: z.enum(["create", "rename", "merge", "split", "update"]),
  canonicalName: z.string().min(1),
  entityType: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  payload: z.record(z.unknown()).default({}),
});

export const RelationshipDeltaSchema = z.object({
  fromEntity: z.string().min(1),
  toEntity: z.string().min(1),
  relationshipType: z.string().min(1),
  operation: z.enum(["create", "change", "end"]),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
});

export const ChapterSummaryPayloadSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().min(1),
  characters: z.string().default(""),
  events: z.string().default(""),
  stateChanges: z.string().default(""),
  hookActivity: z.string().default(""),
  mood: z.string().default(""),
  chapterType: z.string().default(""),
  text: z.string().default(""),
});

export const ProjectionStatusSchema = z.enum(["pending", "running", "done", "skipped", "failed"]);

export const ChapterCommitSchema = z.object({
  schemaVersion: z.string().min(1),
  commitId: z.string().min(16),
  bookId: z.string().min(1),
  chapter: z.number().int().min(1),
  status: z.enum(["accepted", "rejected"]),
  parentCommitId: z.string().nullable(),
  previousCommitHash: z.string().nullable(),
  commitHash: z.string().length(64),
  source: z.object({
    chapterPath: z.string().min(1),
    contentHash: z.string().length(64),
    title: z.string().min(1),
    wordCount: z.number().int().min(0),
  }),
  validation: z.object({
    proseQualityPassed: z.boolean(),
    continuityPassed: z.boolean(),
    fulfillmentPassed: z.boolean(),
    disambiguationPassed: z.boolean(),
    blockingCount: z.number().int().min(0),
    storyConvergencePassed: z.boolean().optional(),
    humanFeelPassed: z.boolean().optional(),
    emotionPassed: z.boolean().optional(),
    payoffPassed: z.boolean().optional(),
    structurePassed: z.boolean().optional(),
    similarityPassed: z.boolean().optional(),
    temporalPassed: z.boolean().optional(),
    humanApprovalPassed: z.boolean().optional(),
  }),
  events: z.array(StoryEventSchema),
  stateDeltas: z.array(StateDeltaSchema),
  entityDeltas: z.array(EntityDeltaSchema),
  relationshipDeltas: z.array(RelationshipDeltaSchema),
  summary: ChapterSummaryPayloadSchema,
  provenance: z.record(z.unknown()),
  projectionStatus: z.record(ProjectionStatusSchema),
  createdAt: z.string().datetime(),
}).superRefine((commit, context) => {
  const accepted = commit.status === "accepted";
  const valid = commit.validation.proseQualityPassed
    && commit.validation.continuityPassed
    && commit.validation.fulfillmentPassed
    && commit.validation.disambiguationPassed
    && commit.validation.storyConvergencePassed !== false
    && commit.validation.humanFeelPassed !== false
    && commit.validation.emotionPassed !== false
    && commit.validation.payoffPassed !== false
    && commit.validation.structurePassed !== false
    && commit.validation.similarityPassed !== false
    && commit.validation.temporalPassed !== false
    && commit.validation.humanApprovalPassed !== false;
  if (accepted !== valid) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "commit status does not match validation result" });
  }
  if (commit.summary.chapter !== commit.chapter) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "summary chapter does not match commit chapter" });
  }
  for (const event of commit.events) {
    if (event.chapter !== commit.chapter) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `event ${event.eventId} chapter mismatch` });
    }
  }
});

export const ChapterAmendmentSchema = z.object({
  schemaVersion: z.literal("inoks-story-story-amendment/v1"),
  amendmentId: z.string().min(16),
  bookId: z.string().min(1),
  chapter: z.number().int().min(1),
  originalCommitId: z.string().min(1),
  reason: z.enum([
    "retcon",
    "fact-correction",
    "entity-merge",
    "entity-split",
    "hook-reclassification",
    "manual-author-override",
  ]),
  previousContentHash: z.string().length(64),
  nextContentHash: z.string().length(64),
  revokedEventIds: z.array(z.string()).default([]),
  addedEvents: z.array(StoryEventSchema).default([]),
  stateCorrections: z.array(StateDeltaSchema).default([]),
  createdAt: z.string().datetime(),
});

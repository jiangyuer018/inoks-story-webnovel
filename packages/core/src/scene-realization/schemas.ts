import { z } from "zod";

export const InformationCarrierSchema = z.enum([
  "dialogue",
  "action",
  "object",
  "reaction",
  "observation",
  "thought",
  "environment",
  "narration",
]);

export const NarrationReasonSchema = z.enum([
  "time-compression",
  "location-transition",
  "minimum-background",
  "causal-clarification",
  "reader-comprehension-repair",
]);

export const RealizationSceneStateSchema = z.object({
  goals: z.array(z.string().min(1)).default([]),
  relationships: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  resources: z.array(z.string().min(1)).default([]),
  information: z.array(z.string().min(1)).default([]),
});

export const RealizedScenePlanSchema = z.object({
  id: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  order: z.number().int().min(1),
  location: z.string().min(1),
  time: z.string().min(1),
  povCharacterId: z.string().min(1),
  cast: z.array(z.string().min(1)).min(1),
  immediateGoal: z.string().min(2),
  oppositionGoal: z.string().min(2),
  stakes: z.string().min(2),
  entryState: RealizationSceneStateSchema,
  exitState: RealizationSceneStateSchema,
  turningPoint: z.string().min(2),
  decisionPoint: z.string().min(2),
  irreversibleChange: z.string().min(2),
  narrativeFunctions: z.array(z.string().min(1)).min(1),
  beatIds: z.array(z.string().min(1)).default([]),
  status: z.enum(["generated", "approved", "writing", "review", "repair", "passed"]).default("generated"),
});

export const CharacterAgendaSchema = z.object({
  characterId: z.string().min(1),
  wantsNow: z.string().min(2),
  fearsNow: z.string().min(2),
  hides: z.array(z.string().min(1)).default([]),
  cannotSayDirectly: z.array(z.string().min(1)).default([]),
  beliefAboutOthers: z.record(z.string().min(1)).default({}),
  tactic: z.string().min(2),
  leverage: z.array(z.string().min(1)).default([]),
  successCondition: z.string().min(2),
  retreatCondition: z.string().min(2),
  knowledgeBoundary: z.object({
    knows: z.array(z.string().min(1)).default([]),
    doesNotKnow: z.array(z.string().min(1)).default([]),
    falselyBelieves: z.array(z.string().min(1)).default([]),
  }),
});

export const InformationUnitSchema = z.object({
  id: z.string().min(1),
  fact: z.string().min(2),
  readerNeedsNow: z.boolean(),
  whoKnows: z.array(z.string().min(1)).default([]),
  whoDoesNotKnow: z.array(z.string().min(1)).default([]),
  whoWantsToHideIt: z.array(z.string().min(1)).default([]),
  possibleCarriers: z.array(InformationCarrierSchema).min(1),
  selectedCarriers: z.array(InformationCarrierSchema).min(1),
  deliveryMethod: z.string().min(2),
  deliveryEvent: z.string().min(2),
  consequence: z.string().min(2),
  narrationAllowed: z.boolean(),
  narrationReason: NarrationReasonSchema.optional(),
});

export const NarrationPermissionSchema = z.object({
  informationUnitId: z.string().min(1),
  reason: NarrationReasonSchema,
  maximumChars: z.number().int().min(1).max(400),
  requiredContent: z.string().min(1),
  forbiddenContent: z.array(z.string().min(1)).default([]),
});

export const InteractionTurnSchema = z.object({
  order: z.number().int().min(1),
  initiator: z.string().min(1),
  stimulus: z.string().min(2),
  responder: z.string().min(1),
  immediateReaction: z.string().min(2),
  interpretation: z.string().min(2),
  strategyBefore: z.string().min(2),
  strategyAfter: z.string().min(2),
  outwardActionOrDialogue: z.string().min(2),
  effectOnOtherCharacter: z.string().min(2),
  informationRevealed: z.array(z.string().min(1)).default([]),
  informationHidden: z.array(z.string().min(1)).default([]),
  stateChange: z.string().min(1).optional(),
});

export const EventConcretenessPlanSchema = z.object({
  eventId: z.string().min(1),
  importance: z.number().min(0).max(1),
  emotionalValue: z.number().min(0).max(1),
  irreversibility: z.number().min(0).max(1),
  plannedSceneCount: z.number().int().min(1).max(5),
  plannedCharBudget: z.number().int().min(200).max(20_000),
  allowedCompression: z.boolean(),
});

export const RealizedSceneSchema = z.object({
  plan: RealizedScenePlanSchema,
  characterAgendas: z.array(CharacterAgendaSchema).min(1),
  informationUnits: z.array(InformationUnitSchema).default([]),
  interactionTurns: z.array(InteractionTurnSchema).min(1),
  narrationPermissions: z.array(NarrationPermissionSchema).default([]),
});

export const SceneRealizationDraftSchema = z.object({
  chapterGoal: z.string().min(2),
  scenes: z.array(RealizedSceneSchema).min(1).max(5),
  concretenessPlan: z.array(EventConcretenessPlanSchema).min(1),
});

export const SceneRealizationBundleSchema = SceneRealizationDraftSchema.extend({
  schemaVersion: z.literal("1.0"),
  chapterNumber: z.number().int().min(1),
  createdAt: z.string().datetime(),
  sourceHash: z.string().min(16),
  tokenUsage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
});

const NullableTextSchema = z.string().min(1).nullable();
const SceneReviewIssueSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["blocking", "advisory"]),
  message: z.string().min(1),
  excerpt: z.string(),
});

export const SemanticSceneReviewSchema = z.object({
  sceneId: z.string().min(1),
  narrationUnits: z.array(z.object({
    excerpt: z.string(), information: z.string(), necessary: z.boolean(), permissionMatched: z.boolean(),
    replacementCarrier: InformationCarrierSchema.optional(),
  })).default([]),
  dialogueTurns: z.array(z.object({
    excerpt: z.string(), speaker: z.string(), speakerGoal: NullableTextSchema,
    respondsToPreviousTurn: z.boolean(), changesInteraction: z.boolean(), informationDump: z.boolean(),
    violatesKnowledgeBoundary: z.boolean(),
  })).default([]),
  actions: z.array(z.object({
    excerpt: z.string(), intention: NullableTextSchema, observableEffect: NullableTextSchema,
    removableWithoutLoss: z.boolean(),
  })).default([]),
  thoughts: z.array(z.object({
    excerpt: z.string(), observation: NullableTextSchema, interpretation: NullableTextSchema,
    beliefChange: NullableTextSchema, strategyChange: NullableTextSchema, decisionChange: NullableTextSchema,
  })).default([]),
  environmentDetails: z.array(z.object({
    excerpt: z.string(), narrativeFunction: NullableTextSchema, affectsAction: z.boolean(), affectsRisk: z.boolean(),
    carriesClue: z.boolean(), necessaryAtmosphere: z.boolean(), removableWithoutLoss: z.boolean(),
  })).default([]),
  informationFulfillment: z.array(z.object({
    informationUnitId: z.string().min(1), delivered: z.boolean(), carrierUsed: z.array(InformationCarrierSchema),
    consequenceVisible: z.boolean(),
  })).default([]),
  interactionFulfillment: z.array(z.object({
    turnOrder: z.number().int().min(1), fulfilled: z.boolean(), missingParts: z.array(z.string()).default([]),
  })).default([]),
  entryExitStateMatch: z.boolean(),
  unintendedFacts: z.array(SceneReviewIssueSchema).default([]),
  missingDramatization: z.array(SceneReviewIssueSchema).default([]),
  verdict: z.enum(["pass", "repair", "block"]),
});

export const SceneSemanticReviewRecordSchema = z.object({
  sceneId: z.string().min(1),
  content: z.string().min(1),
  review: SemanticSceneReviewSchema,
  repairIterations: z.number().int().min(0).max(2),
});

export const ChapterSceneSemanticReportSchema = z.object({
  schemaVersion: z.literal("inoks-story-scene-semantic-report/v1"),
  chapter: z.number().int().min(1),
  writerContentHash: z.string().length(64),
  finalContentHash: z.string().length(64),
  contentChangedAfterSceneReview: z.boolean(),
  sceneCount: z.number().int().min(1),
  verdict: z.enum(["pass", "block"]),
  sceneRealizationPassed: z.boolean(),
  informationDramatizationPassed: z.boolean(),
  interactionChainPassed: z.boolean(),
  reviews: z.array(SceneSemanticReviewRecordSchema),
  createdAt: z.string().datetime(),
}).superRefine((report, context) => {
  const passed = report.sceneRealizationPassed
    && report.informationDramatizationPassed
    && report.interactionChainPassed;
  if ((report.verdict === "pass") !== passed) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "semantic report verdict does not match gates" });
  }
  if (report.reviews.length > report.sceneCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "semantic report has more reviews than planned scenes" });
  }
});

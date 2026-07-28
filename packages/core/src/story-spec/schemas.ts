import { z } from "zod";

export const StoryConstraintStrengthSchema = z.enum(["hard", "soft", "open"]);
export const StorySpecStatusSchema = z.enum(["draft", "approved", "stale", "superseded"]);

export const StoryConstraintSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.string().min(1),
  strength: StoryConstraintStrengthSchema,
});

export const StoryConstraintSetSchema = z.object({
  hard: z.array(StoryConstraintSchema).default([]),
  soft: z.array(StoryConstraintSchema).default([]),
  open: z.array(StoryConstraintSchema).default([]),
});

export const ControlledNarrativeBeatSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1),
  function: z.string().min(1),
  requiredInputs: z.array(z.string()).default([]),
  expectedStateChange: z.array(z.string()).default([]),
  completionCriteria: z.array(z.string()).default([]),
  strength: StoryConstraintStrengthSchema.default("soft"),
  status: z.enum(["pending", "active", "fulfilled", "failed", "skipped"]).default("pending"),
});

export const CharacterSceneAgendaSchema = z.object({
  wants: z.string(),
  fears: z.string(),
  hides: z.array(z.string()).default([]),
  cannotSay: z.array(z.string()).default([]),
  tactic: z.string(),
  leverage: z.array(z.string()).default([]),
  exitCondition: z.string(),
});

export const SceneStateSchema = z.object({
  goals: z.array(z.string()).default([]),
  relationships: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  resources: z.array(z.string()).default([]),
  information: z.array(z.string()).default([]),
});

export const SceneContractSchema = z.object({
  id: z.string().min(1),
  pov: z.string(),
  immediateGoal: z.string().min(1),
  oppositionGoal: z.string(),
  characterAgendas: z.record(CharacterSceneAgendaSchema).default({}),
  knownInformation: z.array(z.string()).default([]),
  hiddenInformation: z.array(z.string()).default([]),
  readerMustLearn: z.array(z.string()).default([]),
  readerMustNotKnowYet: z.array(z.string()).default([]),
  conflictMethod: z.string(),
  turningPoint: z.string(),
  decisionPoint: z.string(),
  irreversibleChange: z.string(),
  entryState: SceneStateSchema,
  exitState: SceneStateSchema,
  narrativeFunctions: z.array(z.string()).min(1),
  deliveryPreference: z.object({
    dialogue: z.enum(["low", "medium", "high"]),
    action: z.enum(["low", "medium", "high"]),
    thought: z.enum(["low", "medium", "high"]),
    narration: z.enum(["minimal", "limited"]),
  }),
  beatIds: z.array(z.string()).default([]),
});

export const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["blocking", "advisory"]),
  evidenceTerms: z.array(z.string()).default([]),
});

export const ChapterSpecSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  status: StorySpecStatusSchema,
  bookId: z.string().min(1),
  volumeId: z.string().min(1),
  arcId: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  pov: z.string(),
  location: z.string(),
  time: z.string(),
  chapterGoal: z.string().min(1),
  readerExpectation: z.array(z.string()).default([]),
  emotionalTrajectoryId: z.string(),
  payoffTargets: z.array(z.string()).default([]),
  plannedEvents: z.array(z.string()).default([]),
  requiredBeats: z.array(z.string()).default([]),
  hardConstraints: z.array(z.string()).default([]),
  softTargets: z.array(z.string()).default([]),
  openSpace: z.array(z.string()).default([]),
  requiredStateChanges: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).default([]),
  sceneContracts: z.array(SceneContractSchema).default([]),
  beats: z.array(ControlledNarrativeBeatSchema).default([]),
  sourceIntentHash: z.string().min(1),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
});

export const PlatformProfileSchema = z.object({
  id: z.enum(["fanqie", "qidian"]),
  targetChapterChars: z.object({
    min: z.number().int().positive(),
    preferred: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  openingPromiseWindow: z.number().int().positive(),
  openingPayoffWindow: z.number().int().positive(),
  minorPayoffInterval: z.number().int().positive(),
  majorPayoffInterval: z.number().int().positive(),
  setupTolerance: z.number().min(0).max(1),
  hookDensity: z.number().min(0),
  expositionTolerance: z.number().min(0).max(1),
  sceneTurnDensity: z.number().min(0),
});

export const StoryConvergenceCheckSchema = z.object({
  gate: z.string().min(1),
  passed: z.boolean(),
  blocking: z.boolean(),
  details: z.array(z.string()).default([]),
});

export const StoryConvergenceResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(StoryConvergenceCheckSchema),
  blockingReasons: z.array(z.string()),
  contentHash: z.string().min(1),
  specId: z.string().min(1),
  specVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
});

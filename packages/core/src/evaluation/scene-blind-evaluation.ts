import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const SceneEvaluationVariantSchema = z.enum([
  "baseline",
  "prompt-only",
  "realization-engine",
]);
export type SceneEvaluationVariant = z.infer<typeof SceneEvaluationVariantSchema>;

export const SceneEvaluationCaseSchema = z.object({
  sampleId: z.string().min(1),
  title: z.string().min(1),
  genre: z.string().min(1),
  chapterGoal: z.string().min(1),
  characters: z.array(z.object({
    id: z.string().min(1),
    wantsNow: z.string().min(1),
    hides: z.array(z.string()).default([]),
    doesNotKnow: z.array(z.string()).default([]),
  })).min(2),
  requiredInformation: z.array(z.string().min(1)).min(1),
  entryState: z.array(z.string().min(1)).min(1),
  exitState: z.array(z.string().min(1)).min(1),
  mustKeep: z.array(z.string()).default([]),
  forbiddenChanges: z.array(z.string()).default([]),
});
export type SceneEvaluationCase = z.infer<typeof SceneEvaluationCaseSchema>;

export const SceneVariantArtifactSchema = z.object({
  artifactId: z.string().min(1),
  sampleId: z.string().min(1),
  variant: SceneEvaluationVariantSchema,
  blindCode: z.string().min(1),
  contentPath: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  seed: z.string().min(1),
});
export type SceneVariantArtifact = z.infer<typeof SceneVariantArtifactSchema>;

const RatingValueSchema = z.number().int().min(1).max(5);

export const BlindSceneRatingSchema = z.object({
  artifactId: z.string().min(1),
  evaluatorId: z.string().min(1),
  humanLikeness: RatingValueSchema,
  characterAgency: RatingValueSchema,
  dialogueInterestAlignment: RatingValueSchema,
  mutualInfluence: RatingValueSchema,
  informationNaturalness: RatingValueSchema,
  narrationNecessity: RatingValueSchema,
  actionConsequence: RatingValueSchema,
  psychologyStrategyChange: RatingValueSchema,
  functionalEnvironment: RatingValueSchema,
  readerContinuationIntent: RatingValueSchema,
  notes: z.string().default(""),
});
export type BlindSceneRating = z.infer<typeof BlindSceneRatingSchema>;

const RATING_KEYS = [
  "humanLikeness",
  "characterAgency",
  "dialogueInterestAlignment",
  "mutualInfluence",
  "informationNaturalness",
  "narrationNecessity",
  "actionConsequence",
  "psychologyStrategyChange",
  "functionalEnvironment",
  "readerContinuationIntent",
] as const satisfies ReadonlyArray<keyof BlindSceneRating>;

export interface SceneBlindEvaluationReport {
  readonly schemaVersion: "inoks-story-scene-blind-evaluation/v1";
  readonly generatedAt: string;
  readonly caseCount: number;
  readonly artifactCount: number;
  readonly ratingCount: number;
  readonly variants: Readonly<Record<SceneEvaluationVariant, {
    readonly sampleCount: number;
    readonly ratedArtifactCount: number;
    readonly metrics: Readonly<Record<(typeof RATING_KEYS)[number], number>>;
    readonly overallMean: number;
  }>>;
  readonly diagnostics: {
    readonly minimumCaseCount: 30;
    readonly missingVariants: ReadonlyArray<string>;
    readonly unratedArtifacts: ReadonlyArray<string>;
    readonly blindCodeCollisions: ReadonlyArray<string>;
    readonly modelOrPromptDrift: ReadonlyArray<string>;
  };
  readonly interpretationStatus: "incomplete" | "eligible-for-human-interpretation";
  readonly humanConclusion: "not-available" | "realization-engine-preferred" | "inconclusive";
  readonly disclaimer: string;
}

export function buildSceneBlindEvaluationReport(params: {
  readonly cases: ReadonlyArray<SceneEvaluationCase>;
  readonly artifacts: ReadonlyArray<SceneVariantArtifact>;
  readonly ratings: ReadonlyArray<BlindSceneRating>;
  readonly generatedAt?: string;
}): SceneBlindEvaluationReport {
  const cases = z.array(SceneEvaluationCaseSchema).parse(params.cases);
  const artifacts = z.array(SceneVariantArtifactSchema).parse(params.artifacts);
  const ratings = z.array(BlindSceneRatingSchema).parse(params.ratings);
  const caseIds = new Set(cases.map((item) => item.sampleId));
  if (caseIds.size !== cases.length) throw new Error("Scene evaluation sampleId values must be unique");
  const artifactIds = new Set(artifacts.map((item) => item.artifactId));
  if (artifactIds.size !== artifacts.length) throw new Error("Scene evaluation artifactId values must be unique");
  for (const artifact of artifacts) {
    if (!caseIds.has(artifact.sampleId)) throw new Error(`Unknown scene evaluation sample: ${artifact.sampleId}`);
  }
  for (const rating of ratings) {
    if (!artifactIds.has(rating.artifactId)) throw new Error(`Unknown blind-review artifact: ${rating.artifactId}`);
  }

  const variants = SceneEvaluationVariantSchema.options;
  const missingVariants = cases.flatMap((item) => variants.flatMap((variant) =>
    artifacts.some((artifact) => artifact.sampleId === item.sampleId && artifact.variant === variant)
      ? []
      : [`${item.sampleId}:${variant}`]));
  const unratedArtifacts = artifacts
    .filter((artifact) => !ratings.some((rating) => rating.artifactId === artifact.artifactId))
    .map((artifact) => artifact.artifactId);
  const blindCodeCollisions = cases.flatMap((item) => {
    const codes = artifacts.filter((artifact) => artifact.sampleId === item.sampleId).map((artifact) => artifact.blindCode);
    return new Set(codes).size === codes.length ? [] : [item.sampleId];
  });
  const modelOrPromptDrift = cases.flatMap((item) => {
    const sampleArtifacts = artifacts.filter((artifact) => artifact.sampleId === item.sampleId);
    const modelSeeds = new Set(sampleArtifacts.map((artifact) => `${artifact.model}\0${artifact.seed}`));
    return modelSeeds.size <= 1 ? [] : [item.sampleId];
  });
  const variantResults = Object.fromEntries(variants.map((variant) => {
    const selectedArtifacts = artifacts.filter((artifact) => artifact.variant === variant);
    const selectedIds = new Set(selectedArtifacts.map((artifact) => artifact.artifactId));
    const selectedRatings = ratings.filter((rating) => selectedIds.has(rating.artifactId));
    const metrics = Object.fromEntries(RATING_KEYS.map((key) => [
      key,
      mean(selectedRatings.map((rating) => rating[key] as number)),
    ])) as Record<(typeof RATING_KEYS)[number], number>;
    return [variant, {
      sampleCount: new Set(selectedArtifacts.map((artifact) => artifact.sampleId)).size,
      ratedArtifactCount: new Set(selectedRatings.map((rating) => rating.artifactId)).size,
      metrics,
      overallMean: mean(Object.values(metrics)),
    }];
  })) as SceneBlindEvaluationReport["variants"];
  const eligible = caseIds.size >= 30
    && missingVariants.length === 0
    && unratedArtifacts.length === 0
    && blindCodeCollisions.length === 0
    && modelOrPromptDrift.length === 0;
  const realizationMean = variantResults["realization-engine"].overallMean;
  const preferred = eligible
    && realizationMean > variantResults.baseline.overallMean
    && realizationMean > variantResults["prompt-only"].overallMean;
  return {
    schemaVersion: "inoks-story-scene-blind-evaluation/v1",
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    caseCount: caseIds.size,
    artifactCount: artifacts.length,
    ratingCount: ratings.length,
    variants: variantResults,
    diagnostics: {
      minimumCaseCount: 30,
      missingVariants,
      unratedArtifacts,
      blindCodeCollisions,
      modelOrPromptDrift,
    },
    interpretationStatus: eligible ? "eligible-for-human-interpretation" : "incomplete",
    humanConclusion: eligible ? preferred ? "realization-engine-preferred" : "inconclusive" : "not-available",
    disclaimer: eligible
      ? "This conclusion summarizes completed human blind ratings; it is not an automated proof of authorship or universal prose quality."
      : "The 30-case, three-variant human blind review is incomplete. Automated metrics must not be presented as proof of improved human likeness.",
  };
}

export async function saveSceneBlindEvaluationReport(
  path: string,
  report: SceneBlindEvaluationReport,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10_000) / 10_000;
}

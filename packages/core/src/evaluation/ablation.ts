import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const AblationConfigurationSchema = z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]);
export type AblationConfigurationId = z.infer<typeof AblationConfigurationSchema>;

export const ABLATION_CONFIGURATIONS: ReadonlyArray<{
  readonly id: AblationConfigurationId;
  readonly label: string;
  readonly mechanisms: ReadonlyArray<string>;
}> = [
  { id: "A", label: "Baseline Writer", mechanisms: [] },
  { id: "B", label: "+ ProseQualityGate", mechanisms: ["prose-quality"] },
  { id: "C", label: "+ Story Spec", mechanisms: ["prose-quality", "story-spec"] },
  { id: "D", label: "+ Event Causal Graph", mechanisms: ["prose-quality", "story-spec", "causal-graph"] },
  { id: "E", label: "+ Emotion Trajectory", mechanisms: ["prose-quality", "story-spec", "causal-graph", "emotion-trajectory"] },
  { id: "F", label: "+ Human Feel Engine", mechanisms: ["prose-quality", "story-spec", "causal-graph", "emotion-trajectory", "human-feel"] },
  { id: "G", label: "+ ChapterCommit + Long Memory", mechanisms: ["prose-quality", "story-spec", "causal-graph", "emotion-trajectory", "human-feel", "chapter-commit", "long-form-memory"] },
  { id: "H", label: "Full System", mechanisms: ["prose-quality", "story-spec", "causal-graph", "emotion-trajectory", "human-feel", "chapter-commit", "long-form-memory", "benchmark-transfer", "payoff-ledger"] },
] as const;

const PercentSchema = z.number().finite().min(0).max(100);
const RatioSchema = z.number().finite().min(0).max(1);

export const BlindRatingSchema = z.object({
  evaluatorId: z.string().min(1),
  plotCompleteness: z.number().min(1).max(5),
  causalCoherence: z.number().min(1).max(5),
  emotionArcQuality: z.number().min(1).max(5),
  naturalness: z.number().min(1).max(5),
  readerRetention: z.number().min(1).max(5),
  overall: z.number().min(1).max(5),
});

export const AblationRunSchema = z.object({
  configuration: AblationConfigurationSchema,
  sampleId: z.string().min(1),
  seed: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  observations: z.object({
    plotCompleteness: PercentSchema,
    causalCoherence: PercentSchema,
    emotionArcQuality: PercentSchema,
    expositionRatio: RatioSchema,
    actionDialogueCoupling: PercentSchema,
    beatFulfillment: PercentSchema,
    humanFeel: PercentSchema,
    continuityConflicts: z.number().int().min(0),
    memoryConsistency: PercentSchema,
    postEditRatio: RatioSchema,
    similarityRisk: RatioSchema,
  }),
  blindRatings: BlindRatingSchema.array().default([]),
});

export type AblationRun = z.infer<typeof AblationRunSchema>;

export interface AblationMetricSummary {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly direction: "higher-is-better" | "lower-is-better";
  readonly source: "automated" | "human-blind";
}

export interface AblationConfigurationResult {
  readonly id: AblationConfigurationId;
  readonly label: string;
  readonly mechanisms: ReadonlyArray<string>;
  readonly sampleCount: number;
  readonly metrics: Readonly<Record<string, AblationMetricSummary>>;
  readonly humanBlindOverall: AblationMetricSummary | null;
}

export interface AblationReport {
  readonly schemaVersion: "inkos-ablation/v1";
  readonly generatedAt: string;
  readonly configurations: ReadonlyArray<AblationConfigurationResult>;
  readonly diagnostics: {
    readonly pairedSampleIds: ReadonlyArray<string>;
    readonly incompleteSampleIds: ReadonlyArray<string>;
    readonly modelOrPromptDrift: ReadonlyArray<string>;
    readonly hasHumanBlindRatingsForEveryConfiguration: boolean;
  };
  readonly interpretationStatus: "engineering-only" | "eligible-for-human-interpretation";
  readonly disclaimer: string;
}

const automatedMetricDefinitions = [
  ["plotCompleteness", "higher-is-better", (run: AblationRun) => run.observations.plotCompleteness],
  ["causalCoherence", "higher-is-better", (run: AblationRun) => run.observations.causalCoherence],
  ["emotionArcQuality", "higher-is-better", (run: AblationRun) => run.observations.emotionArcQuality],
  ["expositionRatio", "lower-is-better", (run: AblationRun) => run.observations.expositionRatio],
  ["actionDialogueCoupling", "higher-is-better", (run: AblationRun) => run.observations.actionDialogueCoupling],
  ["beatFulfillment", "higher-is-better", (run: AblationRun) => run.observations.beatFulfillment],
  ["humanFeel", "higher-is-better", (run: AblationRun) => run.observations.humanFeel],
  ["continuityConflicts", "lower-is-better", (run: AblationRun) => run.observations.continuityConflicts],
  ["memoryConsistency", "higher-is-better", (run: AblationRun) => run.observations.memoryConsistency],
  ["postEditRatio", "lower-is-better", (run: AblationRun) => run.observations.postEditRatio],
  ["similarityRisk", "lower-is-better", (run: AblationRun) => run.observations.similarityRisk],
] as const;

export function buildAblationReport(
  input: ReadonlyArray<AblationRun>,
  generatedAt = new Date().toISOString(),
): AblationReport {
  const runs = z.array(AblationRunSchema).min(1).parse(input);
  const sampleConfigurations = new Map<string, Set<AblationConfigurationId>>();
  const signatures = new Map<string, Set<string>>();
  for (const run of runs) {
    const configurations = sampleConfigurations.get(run.sampleId) ?? new Set<AblationConfigurationId>();
    configurations.add(run.configuration);
    sampleConfigurations.set(run.sampleId, configurations);
    const sampleSignatures = signatures.get(run.sampleId) ?? new Set<string>();
    sampleSignatures.add(`${run.model}\0${run.promptVersion}\0${run.seed}`);
    signatures.set(run.sampleId, sampleSignatures);
  }
  const expected = ABLATION_CONFIGURATIONS.length;
  const pairedSampleIds = [...sampleConfigurations]
    .filter(([, configurations]) => configurations.size === expected)
    .map(([sampleId]) => sampleId)
    .sort();
  const incompleteSampleIds = [...sampleConfigurations]
    .filter(([, configurations]) => configurations.size !== expected)
    .map(([sampleId]) => sampleId)
    .sort();
  const modelOrPromptDrift = [...signatures]
    .filter(([, values]) => values.size !== 1)
    .map(([sampleId]) => sampleId)
    .sort();

  const configurations = ABLATION_CONFIGURATIONS.map((definition): AblationConfigurationResult => {
    const selected = runs.filter((run) => run.configuration === definition.id);
    const metrics = Object.fromEntries(automatedMetricDefinitions.map(([key, direction, select]) => [
      key,
      summarize(selected.map(select), direction, "automated"),
    ]));
    const humanValues = selected.flatMap((run) => run.blindRatings.map((rating) => rating.overall));
    return {
      ...definition,
      sampleCount: selected.length,
      metrics,
      humanBlindOverall: humanValues.length > 0
        ? summarize(humanValues, "higher-is-better", "human-blind")
        : null,
    };
  });
  const hasHumanBlindRatingsForEveryConfiguration = configurations.every((result) => result.humanBlindOverall !== null);
  const eligible = incompleteSampleIds.length === 0
    && modelOrPromptDrift.length === 0
    && hasHumanBlindRatingsForEveryConfiguration;
  return {
    schemaVersion: "inkos-ablation/v1",
    generatedAt,
    configurations,
    diagnostics: {
      pairedSampleIds,
      incompleteSampleIds,
      modelOrPromptDrift,
      hasHumanBlindRatingsForEveryConfiguration,
    },
    interpretationStatus: eligible ? "eligible-for-human-interpretation" : "engineering-only",
    disclaimer: eligible
      ? "This report is eligible for human interpretation; it does not by itself prove that narrative quality is solved."
      : "Automated or unpaired results are engineering diagnostics only and must not be presented as evidence that narrative quality is solved.",
  };
}

export async function saveAblationReport(path: string, report: AblationReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

function summarize(
  values: ReadonlyArray<number>,
  direction: "higher-is-better" | "lower-is-better",
  source: "automated" | "human-blind",
): AblationMetricSummary {
  if (values.length === 0) return { mean: 0, min: 0, max: 0, direction, source };
  const rounded = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    mean: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    min: rounded(Math.min(...values)),
    max: rounded(Math.max(...values)),
    direction,
    source,
  };
}

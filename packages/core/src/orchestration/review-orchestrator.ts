import { BenchmarkStore, type SimilarityReport } from "../benchmark/index.js";
import {
  auditEmotionTrajectory,
  detectMissingNarrativeLogic,
  evaluateOutlineControl,
  extractNarrativeLogicNodes,
} from "../narrative-research/index.js";
import { auditPayoff, savePayoffAudit } from "../story-craft/index.js";
import type { CompiledWritingContract } from "../story-spec/index.js";

export interface DeterministicChapterReviewResult {
  readonly outlineControl: ReturnType<typeof evaluateOutlineControl>;
  readonly emotionAudit: ReturnType<typeof auditEmotionTrajectory> | undefined;
  readonly missingLogicIssues: ReturnType<typeof detectMissingNarrativeLogic>;
  readonly payoffAudit: ReturnType<typeof auditPayoff>;
  readonly payoffReportPath: string;
  readonly similarityReport: SimilarityReport;
  readonly similarityReportPath: string;
}

/** Runs the deterministic and structured pre-commit review bundle. */
export async function runDeterministicChapterReview(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly content: string;
  readonly contract: CompiledWritingContract;
}): Promise<DeterministicChapterReviewResult> {
  const outlineControl = evaluateOutlineControl({
    content: params.content,
    beats: params.contract.activeBeatContracts,
    allowedStateChanges: params.contract.chapterSpec.requiredStateChanges,
  });
  const emotionAudit = params.contract.emotionalTrajectory
    ? auditEmotionTrajectory(params.content, params.contract.emotionalTrajectory)
    : undefined;
  const missingLogicIssues = detectMissingNarrativeLogic(
    extractNarrativeLogicNodes(params.content),
  );
  const payoffAudit = auditPayoff({
    content: params.content,
    chapter: params.chapterNumber,
    targets: params.contract.payoffTargets,
  });
  const payoffReportPath = await savePayoffAudit({
    bookDir: params.bookDir,
    chapter: params.chapterNumber,
    audit: payoffAudit,
  });
  const benchmarkStore = new BenchmarkStore(params.bookDir);
  const scenes = params.contract.chapterSpec.sceneRealization?.scenes ?? [];
  const similarityReport = await benchmarkStore.analyzeSimilarity({
    text: params.content,
    eventSequence: params.contract.chapterSpec.plannedEvents,
    entities: [...new Set([
      params.contract.chapterSpec.pov,
      ...scenes.flatMap((scene) => [scene.plan.povCharacterId, ...scene.plan.cast]),
    ].filter(Boolean))],
    relationships: [...new Set(scenes.flatMap((scene) => [
      ...scene.plan.entryState.relationships,
      ...scene.plan.exitState.relationships,
      ...scene.characterAgendas.flatMap((agenda) => Object.keys(agenda.beliefAboutOthers)),
    ]).filter(Boolean))],
    sceneFunctions: scenes.flatMap((scene) => scene.plan.narrativeFunctions),
    beatSequence: [
      ...params.contract.activeBeatContracts.map((beat) => beat.function),
      ...scenes.flatMap((scene) => scene.plan.beatIds),
    ],
  });
  const similarityReportPath = await benchmarkStore.saveSimilarityReport(
    params.chapterNumber,
    similarityReport,
  );
  return {
    outlineControl,
    emotionAudit,
    missingLogicIssues,
    payoffAudit,
    payoffReportPath,
    similarityReport,
    similarityReportPath,
  };
}

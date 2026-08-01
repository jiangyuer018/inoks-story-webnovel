import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ChapterSceneSemanticReport,
  SceneRealizationBundle,
  SceneSemanticReviewRecord,
} from "./types.js";
import { ChapterSceneSemanticReportSchema } from "./schemas.js";

export const SCENE_SEMANTIC_REPORT_SCHEMA_VERSION = "inoks-story-scene-semantic-report/v1" as const;

export function evaluateSceneSemanticReviews(params: {
  readonly realization: SceneRealizationBundle;
  readonly reviews: ReadonlyArray<SceneSemanticReviewRecord>;
}): Pick<
  ChapterSceneSemanticReport,
  "sceneRealizationPassed" | "informationDramatizationPassed" | "interactionChainPassed" | "verdict"
> {
  const byScene = new Map(params.reviews.map((record) => [record.sceneId, record]));
  const sceneRealizationPassed = params.realization.scenes.length > 0
    && params.realization.scenes.every((scene) => {
      const review = byScene.get(scene.plan.id)?.review;
      return review?.verdict === "pass"
        && review.entryExitStateMatch
        && !review.unintendedFacts.some((issue) => issue.severity === "blocking")
        && !review.dialogueTurns.some((turn) => turn.violatesKnowledgeBoundary);
    });
  const informationDramatizationPassed = sceneRealizationPassed
    && params.realization.scenes.every((scene) => {
      const review = byScene.get(scene.plan.id)!.review;
      const fulfillment = new Map(review.informationFulfillment.map((item) => [item.informationUnitId, item]));
      return review.missingDramatization.length === 0
        && scene.informationUnits.every((unit) => {
          const item = fulfillment.get(unit.id);
          return item?.delivered === true
            && item.consequenceVisible === true
            && item.carrierUsed.length > 0;
        })
        && review.narrationUnits.every((unit) => unit.necessary && unit.permissionMatched);
    });
  const interactionChainPassed = sceneRealizationPassed
    && params.realization.scenes.every((scene) => {
      const review = byScene.get(scene.plan.id)!.review;
      const fulfillment = new Map(review.interactionFulfillment.map((item) => [item.turnOrder, item]));
      return scene.interactionTurns.every((turn) => {
        const item = fulfillment.get(turn.order);
        return item?.fulfilled === true && item.missingParts.length === 0;
      })
        && review.dialogueTurns.every((turn) => (
          turn.respondsToPreviousTurn
          && turn.changesInteraction
          && !turn.informationDump
          && !turn.violatesKnowledgeBoundary
          && turn.speakerGoal !== null
        ));
    });
  return {
    sceneRealizationPassed,
    informationDramatizationPassed,
    interactionChainPassed,
    verdict: sceneRealizationPassed && informationDramatizationPassed && interactionChainPassed
      ? "pass"
      : "block",
  };
}

export function partitionFinalChapterByScene(params: {
  readonly finalContent: string;
  readonly originalScenes: ReadonlyArray<SceneSemanticReviewRecord>;
}): ReadonlyArray<string> {
  const sceneCount = params.originalScenes.length;
  if (sceneCount <= 1) return sceneCount === 1 ? [params.finalContent.trim()] : [];
  const paragraphs = params.finalContent
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length < sceneCount) return [];

  const originalTotal = params.originalScenes.reduce((sum, scene) => sum + Math.max(1, scene.content.length), 0);
  const finalTotal = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  const result: string[] = [];
  let paragraphIndex = 0;
  let consumedChars = 0;
  let cumulativeOriginal = 0;
  for (let sceneIndex = 0; sceneIndex < sceneCount - 1; sceneIndex += 1) {
    cumulativeOriginal += Math.max(1, params.originalScenes[sceneIndex]!.content.length);
    const target = finalTotal * (cumulativeOriginal / originalTotal);
    const remainingScenes = sceneCount - sceneIndex - 1;
    const part: string[] = [];
    while (paragraphIndex < paragraphs.length - remainingScenes) {
      const paragraph = paragraphs[paragraphIndex]!;
      part.push(paragraph);
      paragraphIndex += 1;
      consumedChars += paragraph.length;
      if (consumedChars >= target) break;
    }
    result.push(part.join("\n\n"));
  }
  result.push(paragraphs.slice(paragraphIndex).join("\n\n"));
  return result.every(Boolean) ? result : [];
}

export async function saveChapterSceneSemanticReport(params: {
  readonly bookDir: string;
  readonly chapter: number;
  readonly writerContent: string;
  readonly finalContent: string;
  readonly realization: SceneRealizationBundle;
  readonly reviews: ReadonlyArray<SceneSemanticReviewRecord>;
  readonly createdAt?: string;
}): Promise<{ readonly report: ChapterSceneSemanticReport; readonly reportPath: string }> {
  const evaluation = evaluateSceneSemanticReviews({
    realization: params.realization,
    reviews: params.reviews,
  });
  const report = ChapterSceneSemanticReportSchema.parse({
    schemaVersion: SCENE_SEMANTIC_REPORT_SCHEMA_VERSION,
    chapter: params.chapter,
    writerContentHash: hashText(params.writerContent),
    finalContentHash: hashText(params.finalContent),
    contentChangedAfterSceneReview: params.writerContent !== params.finalContent,
    sceneCount: params.realization.scenes.length,
    ...evaluation,
    reviews: params.reviews,
    createdAt: params.createdAt ?? new Date().toISOString(),
  }) as ChapterSceneSemanticReport;
  const reportPath = join(
    params.bookDir,
    "quality",
    "scene-semantic",
    `chapter-${String(params.chapter).padStart(4, "0")}.json`,
  );
  await writeJsonAtomic(reportPath, report);
  return { report, reportPath };
}

function hashText(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

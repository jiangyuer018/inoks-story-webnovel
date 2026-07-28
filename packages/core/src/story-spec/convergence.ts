import { writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "../story-system/commit.js";
import type {
  ChapterSpec,
  OutlineControlResult,
  StoryConvergenceCheck,
  StoryConvergenceResult,
} from "./types.js";
import { StoryConvergenceResultSchema } from "./schemas.js";
import { storySpecRoot } from "./constitution-loader.js";

export interface StoryConvergenceInput {
  readonly bookDir?: string;
  readonly content: string;
  readonly spec: ChapterSpec;
  readonly outlineControl: OutlineControlResult;
  readonly gates: ReadonlyArray<StoryConvergenceCheck>;
}

export async function runStoryConvergence(input: StoryConvergenceInput): Promise<StoryConvergenceResult> {
  const checks: ReadonlyArray<StoryConvergenceCheck> = [
    {
      gate: "story-spec-status",
      passed: input.spec.status === "approved",
      blocking: true,
      details: input.spec.status === "approved" ? [] : [`Spec status is ${input.spec.status}`],
    },
    {
      gate: "detailed-outline-controller",
      passed: input.outlineControl.verdict === "continue",
      blocking: input.outlineControl.verdict === "block",
      details: [
        ...input.outlineControl.missingBeatIds.map((id) => `Missing beat: ${id}`),
        ...input.outlineControl.unexpectedStateChanges.map((item) => `Unexpected state change: ${item}`),
      ],
    },
    ...input.gates,
  ];
  const blockingReasons = checks
    .filter((check) => !check.passed && check.blocking)
    .flatMap((check) => check.details.length > 0 ? check.details : [`${check.gate} failed`]);
  const result = StoryConvergenceResultSchema.parse({
    passed: blockingReasons.length === 0,
    checks,
    blockingReasons,
    contentHash: sha256(input.content),
    specId: input.spec.id,
    specVersion: input.spec.version,
    createdAt: new Date().toISOString(),
  });
  if (input.bookDir) {
    const path = join(
      storySpecRoot(input.bookDir),
      "chapters",
      `chapter-${String(input.spec.chapterNumber).padStart(4, "0")}`,
      "convergence.json",
    );
    await writeJsonAtomic(path, result);
  }
  return result;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

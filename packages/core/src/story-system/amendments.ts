import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ChapterAmendmentSchema } from "./schemas.js";
import type { StateDelta, StoryEvent } from "./types.js";

export type ChapterAmendmentReason =
  | "retcon"
  | "fact-correction"
  | "entity-merge"
  | "entity-split"
  | "hook-reclassification"
  | "manual-author-override";

export async function saveChapterAmendment(params: {
  readonly bookDir: string;
  readonly bookId: string;
  readonly chapter: number;
  readonly originalCommitId: string;
  readonly previousContentHash: string;
  readonly nextContentHash: string;
  readonly reason: ChapterAmendmentReason;
  readonly revokedEventIds?: ReadonlyArray<string>;
  readonly addedEvents?: ReadonlyArray<StoryEvent>;
  readonly stateCorrections?: ReadonlyArray<StateDelta>;
  readonly createdAt?: string;
}): Promise<{ readonly amendmentId: string; readonly path: string }> {
  const amendmentId = `amendment-${createHash("sha256").update([
    params.bookId,
    params.chapter,
    params.originalCommitId,
    params.nextContentHash,
    params.reason,
  ].join("\0")).digest("hex").slice(0, 32)}`;
  const value = ChapterAmendmentSchema.parse({
    schemaVersion: "inoks-story-story-amendment/v1",
    amendmentId,
    bookId: params.bookId,
    chapter: params.chapter,
    originalCommitId: params.originalCommitId,
    reason: params.reason,
    previousContentHash: params.previousContentHash,
    nextContentHash: params.nextContentHash,
    revokedEventIds: [...(params.revokedEventIds ?? [])],
    addedEvents: [...(params.addedEvents ?? [])],
    stateCorrections: [...(params.stateCorrections ?? [])],
    createdAt: params.createdAt ?? new Date().toISOString(),
  });
  const path = join(params.bookDir, ".inoks-story-webnovel", "story-system", "amendments", `chapter-${String(params.chapter).padStart(4, "0")}.${amendmentId}.json`);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temp, path);
  return { amendmentId, path };
}

export class HistoryDivergedError extends Error {
  readonly code = "STORY_HISTORY_DIVERGED";

  constructor(readonly chapter: number, readonly commitId: string) {
    super(`Chapter ${chapter} differs from accepted commit ${commitId}. Create a ChapterAmendment and replay projections instead of overwriting history.`);
    this.name = "HistoryDivergedError";
  }
}

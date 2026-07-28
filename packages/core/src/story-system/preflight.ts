import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ChapterCommitStore, sha256 } from "./commit.js";
import {
  latestProjectionFailures,
  normalizeChapterSummariesDocument,
} from "./projections.js";
import { recoverChapterTransactions } from "./transaction.js";
import { MemoryDB } from "../state/memory-db.js";

export interface StorySystemPreflightResult {
  readonly passed: boolean;
  readonly headCommitId: string | null;
  readonly headChapter: number;
  readonly repairedTransactions: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export async function runStorySystemPreflight(params: {
  readonly bookDir: string;
  readonly strict: boolean;
  readonly blockOnProjectionFailure: boolean;
}): Promise<StorySystemPreflightResult> {
  const repairedTransactions = await recoverChapterTransactions(params.bookDir);
  const store = new ChapterCommitStore(params.bookDir);
  const errors: string[] = [];
  const warnings: string[] = [];
  let head = null;
  try {
    await store.verifyChain();
    head = await store.loadHead();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const failures = await latestProjectionFailures(params.bookDir);
  if (failures.length > 0) {
    (params.blockOnProjectionFailure ? errors : warnings).push(`Projection pending: ${failures.join("; ")}`);
  }
  const existingChapterFiles = (await readdir(join(params.bookDir, "chapters")).catch(() => [] as string[]))
    .filter((name) => /^\d{4}_.+\.md$/.test(name));
  if (!head && existingChapterFiles.length > 0) {
    errors.push("legacy-history-unmigrated: existing chapters have no accepted ChapterCommit; run `inoks-story story migrate <bookId>`");
  }
  if (head) {
    try {
      const db = new MemoryDB(params.bookDir);
      try {
        const projected = db.getLastProjectedCommit();
        if (!projected || projected.commitId !== head.commitId) {
          (params.blockOnProjectionFailure ? errors : warnings).push(
            `MemoryDB projection is behind HEAD ${head.commitId}`,
          );
        }
      } finally {
        db.close();
      }
    } catch {
      warnings.push("MemoryDB preflight unavailable; Markdown and commit-chain checks remain active.");
    }
  }
  const commits = await store.listCommits().catch(() => []);
  if (head) {
    const expectedMarkdown = new Map<string, string>();
    const projectionFiles = [
      ["currentStateMarkdown", "current_state.md"],
      ["ledgerMarkdown", "particle_ledger.md"],
      ["hooksMarkdown", "pending_hooks.md"],
      ["chapterSummariesMarkdown", "chapter_summaries.md"],
      ["subplotsMarkdown", "subplot_board.md"],
      ["emotionalArcsMarkdown", "emotional_arcs.md"],
      ["characterMatrixMarkdown", "character_matrix.md"],
    ] as const;
    for (const commit of commits) {
      if (commit.status !== "accepted") continue;
      const payload = commit.provenance.projectionPayload;
      if (!payload || typeof payload !== "object") continue;
      for (const [key, file] of projectionFiles) {
        const value = (payload as Record<string, unknown>)[key];
        if (typeof value !== "string" || !value.trim()) continue;
        expectedMarkdown.set(
          file,
          key === "chapterSummariesMarkdown"
            ? normalizeChapterSummariesDocument(
                value,
                commit.provenance.language === "en" ? "en" : "zh",
              )
            : value,
        );
      }
    }
    for (const [file, expected] of expectedMarkdown) {
      const actual = await readFile(join(params.bookDir, "story", file), "utf-8").catch(() => "");
      if (!actual) {
        errors.push(`Projection missing: story/${file}`);
      } else if (sha256(actual) !== sha256(expected)) {
        errors.push(`projection-drift: story/${file} differs from accepted ChapterCommit`);
      }
    }
  }
  const latestByChapter = new Map<number, (typeof commits)[number]>();
  for (const commit of commits) latestByChapter.set(commit.chapter, commit);
  for (const commit of commits) {
    if (commit.status !== "accepted") continue;
    if (latestByChapter.get(commit.chapter)?.commitId !== commit.commitId) continue;
    const path = join(params.bookDir, commit.source.chapterPath);
    const raw = await readFile(path, "utf-8").catch(() => "");
    if (!raw) {
      errors.push(`Missing chapter file for commit ${commit.commitId}`);
      continue;
    }
    const body = raw.replace(/^# .*\r?\n+/, "");
    if (sha256(body) !== commit.source.contentHash) {
      errors.push(`history-diverged: chapter ${commit.chapter} body hash differs from accepted commit`);
    }
  }
  const passed = params.strict ? errors.length === 0 : !errors.some((error) => error.startsWith("history-diverged"));
  return {
    passed,
    headCommitId: head?.commitId ?? null,
    headChapter: head ? Number(head.provenance.canonicalHeadChapter ?? head.chapter) : 0,
    repairedTransactions,
    errors,
    warnings,
  };
}

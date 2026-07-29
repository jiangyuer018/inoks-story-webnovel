import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { countChapterLength } from "../utils/length-metrics.js";
import {
  parseChapterSummariesMarkdown,
} from "../utils/story-markdown.js";
import {
  buildChapterCommit,
  ChapterCommitStore,
  extractCandidatesFromTruthProjection,
  sha256,
  validateChapterCommit,
} from "./commit.js";
import { replayStorySystem } from "./projections.js";
import type { ChapterCommit, ChapterSummaryPayload } from "./types.js";

export interface StoryMigrationReport {
  readonly migrationId: string;
  readonly applied: boolean;
  readonly bookId: string;
  readonly chapterCount: number;
  readonly commitIds: ReadonlyArray<string>;
  readonly backupPath?: string;
  readonly reportPath: string;
  readonly warnings: ReadonlyArray<string>;
  readonly projectionDiffs: ReadonlyArray<{
    readonly file: string;
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly matches: boolean;
  }>;
}

export async function loadLatestStoryMigrationReport(
  bookDir: string,
): Promise<StoryMigrationReport | null> {
  const migrationsDir = join(bookDir, ".inoks-story-webnovel", "story-system", "migrations");
  const names = await readdir(migrationsDir).catch(() => [] as string[]);
  let latest: { readonly report: StoryMigrationReport; readonly modifiedAt: number } | null = null;
  for (const name of names) {
    const reportPath = join(migrationsDir, name, "report.json");
    const raw = await readFile(reportPath, "utf-8").catch(() => "");
    if (!raw) continue;
    try {
      const report = JSON.parse(raw) as StoryMigrationReport;
      const modifiedAt = await stat(reportPath).then((value) => value.mtimeMs, () => 0);
      if (!latest || modifiedAt > latest.modifiedAt) {
        latest = { report, modifiedAt };
      }
    } catch {
      // An interrupted/invalid report is represented by its checkpoint and must
      // not be surfaced as an actionable completed preview.
    }
  }
  return latest?.report ?? null;
}

/**
 * Bootstrap an existing Inoks Story Webnovel book into the commit authority without changing
 * its chapter text. Dry-run is the default; --apply is deliberately explicit.
 *
 * Legacy files cannot reconstruct facts that were never recorded per chapter,
 * so current facts/hooks are attached to the final bootstrap commit and the
 * limitation is reported. New commits preserve full temporal history.
 */
export async function migrateLegacyStorySystem(params: {
  readonly projectRoot: string;
  readonly bookDir: string;
  readonly bookId: string;
  readonly apply?: boolean;
}): Promise<StoryMigrationReport> {
  const store = new ChapterCommitStore(params.bookDir);
  const existingHead = await store.loadHead();
  if (existingHead) {
    const migrationId = typeof existingHead.provenance.migrationId === "string"
      ? existingHead.provenance.migrationId
      : null;
    const reportPath = migrationId
      ? join(store.root, "migrations", migrationId, "report.json")
      : "";
    if (migrationId) {
      const completed = await readFile(reportPath, "utf-8").catch(() => "");
      if (completed) return JSON.parse(completed) as StoryMigrationReport;
      return resumeAppliedMigration({
        bookDir: params.bookDir,
        bookId: params.bookId,
        store,
        migrationId,
        reportPath,
      });
    }
    throw new Error(`Book "${params.bookId}" already uses ChapterCommit authority.`);
  }
  const chapterDir = join(params.bookDir, "chapters");
  const names = (await readdir(chapterDir))
    .filter((name) => /^\d{4}_.+\.md$/.test(name))
    .sort();
  if (names.length === 0) throw new Error(`Book "${params.bookId}" has no chapters to migrate.`);
  for (let index = 0; index < names.length; index += 1) {
    const chapter = Number.parseInt(names[index]!.slice(0, 4), 10);
    if (chapter !== index + 1) {
      throw new Error(`Legacy chapter sequence is not contiguous: expected ${index + 1}, got ${chapter}.`);
    }
  }

  const chapterDocuments = await Promise.all(
    names.map((name) => readFile(join(chapterDir, name), "utf-8")),
  );
  const migrationId = `migration-${sha256([
    params.bookId,
    ...names.map((name, index) => `${name}:${sha256(chapterDocuments[index]!)}`),
  ].join("\0")).slice(0, 24)}`;
  const storyDir = join(params.bookDir, "story");
  const [currentState, hooks, chapterSummaries, ledger, subplots, emotionalArcs, characterMatrix] =
    await Promise.all([
      readText(join(storyDir, "current_state.md")),
      readText(join(storyDir, "pending_hooks.md")),
      readText(join(storyDir, "chapter_summaries.md")),
      readText(join(storyDir, "particle_ledger.md")),
      readText(join(storyDir, "subplot_board.md")),
      readText(join(storyDir, "emotional_arcs.md")),
      readText(join(storyDir, "character_matrix.md")),
    ]);
  const parsedSummaries = parseChapterSummariesMarkdown(chapterSummaries);
  const migrationRoot = join(store.root, "migrations", migrationId);
  const candidateDir = join(migrationRoot, "commits");
  await mkdir(candidateDir, { recursive: true });
  await writeJsonAtomic(join(migrationRoot, "checkpoint.json"), {
    migrationId,
    phase: "analyzing",
    completedChapters: 0,
    totalChapters: names.length,
    updatedAt: new Date().toISOString(),
  });

  const commits: ChapterCommit[] = [];
  let parent: ChapterCommit | null = null;
  for (let index = 0; index < names.length; index += 1) {
    const chapter = index + 1;
    const chapterPath = join(chapterDir, names[index]!);
    const raw = chapterDocuments[index]!;
    const heading = raw.match(/^#\s+(.+)\r?\n/);
    const body = raw.replace(/^# .*\r?\n+/, "");
    const title = extractHeadingTitle(heading?.[1] ?? basename(names[index]!, ".md"), chapter);
    const summaryRow = parsedSummaries.find((row) => row.chapter === chapter);
    const isLast = chapter === names.length;
    const extraction = isLast
      ? extractCandidatesFromTruthProjection({
          chapter,
          content: body,
          previousStateMarkdown: "",
          nextStateMarkdown: currentState,
          previousHooksMarkdown: "",
          nextHooksMarkdown: hooks,
        })
      : {
          acceptedCandidates: [],
          ambiguousCandidates: [],
          rejectedCandidates: [],
          stateDeltas: [],
        };
    const summary: ChapterSummaryPayload = {
      chapter,
      title: summaryRow?.title || title,
      characters: summaryRow?.characters ?? "",
      events: summaryRow?.events ?? "",
      stateChanges: summaryRow?.stateChanges ?? "",
      hookActivity: summaryRow?.hookActivity ?? "",
      mood: summaryRow?.mood ?? "",
      chapterType: summaryRow?.chapterType ?? "",
      text: summaryRow
        ? [
            summaryRow.events,
            summaryRow.stateChanges,
            summaryRow.hookActivity,
          ].filter(Boolean).join("\n")
        : "",
    };
    const createdAt = (await stat(chapterPath)).mtime.toISOString();
    const commit = buildChapterCommit({
      bookId: params.bookId,
      bookDir: params.bookDir,
      chapter,
      title,
      content: body,
      wordCount: countChapterLength(body, "zh_chars"),
      chapterPath,
      parentCommit: parent,
      proseQualityPassed: true,
      continuityPassed: true,
      fulfillmentPassed: true,
      blockingCount: 0,
      extendedValidation: {
        storyConvergencePassed: true,
        humanFeelPassed: true,
        emotionPassed: true,
        payoffPassed: true,
        structurePassed: true,
        similarityPassed: true,
        temporalPassed: true,
        humanApprovalPassed: true,
      },
      candidates: extraction,
      stateDeltas: extraction.stateDeltas,
      summary,
      projectionPayload: isLast
        ? {
            currentStateMarkdown: currentState,
            hooksMarkdown: hooks,
            chapterSummariesMarkdown: chapterSummaries,
            ledgerMarkdown: ledger,
            subplotsMarkdown: subplots,
            emotionalArcsMarkdown: emotionalArcs,
            characterMatrixMarkdown: characterMatrix,
          }
        : {},
      provenance: {
        migration: "legacy-bootstrap",
        migrationId,
        legacySourcePath: relative(params.projectRoot, chapterPath).replace(/\\/g, "/"),
      },
      createdAt,
    });
    validateChapterCommit({ commit, content: body, head: parent });
    commits.push(commit);
    parent = commit;
    await writeJsonAtomic(
      join(candidateDir, `chapter-${String(chapter).padStart(4, "0")}.commit.json`),
      commit,
    );
    await writeJsonAtomic(join(migrationRoot, "checkpoint.json"), {
      migrationId,
      phase: "analyzing",
      completedChapters: chapter,
      totalChapters: names.length,
      updatedAt: new Date().toISOString(),
    });
  }

  const warnings = [
    "Legacy history has no per-chapter event provenance; current facts and hooks are bootstrapped on the final legacy commit.",
    "Dry-run candidates do not switch authority. Re-run with --apply after reviewing the report.",
  ];
  let backupPath: string | undefined;
  let projectionDiffs: StoryMigrationReport["projectionDiffs"] = [];
  if (params.apply) {
    backupPath = join(params.bookDir, ".inoks-story-webnovel", "backups", migrationId);
    await mkdir(backupPath, { recursive: true });
    await Promise.all([
      cp(chapterDir, join(backupPath, "chapters"), { recursive: true }),
      cp(storyDir, join(backupPath, "story"), { recursive: true }),
    ]);
    await writeJsonAtomic(join(migrationRoot, "checkpoint.json"), {
      migrationId,
      phase: "backed-up",
      completedChapters: commits.length,
      totalChapters: commits.length,
      backupPath,
      updatedAt: new Date().toISOString(),
    });
    for (const commit of commits) {
      const sourceDocument = await readFile(join(params.bookDir, commit.source.chapterPath), "utf-8");
      await writeJsonAtomic(store.commitPathFor(commit), commit);
      await writeJsonAtomic(store.eventPathFor(commit), commit.events);
      await writeAtomic(store.sourcePath(commit.commitId), sourceDocument);
      await writeJsonAtomic(join(migrationRoot, "checkpoint.json"), {
        migrationId,
        phase: "committing",
        completedChapters: commit.chapter,
        totalChapters: commits.length,
        backupPath,
        updatedAt: new Date().toISOString(),
      });
    }
    await writeAtomic(join(store.root, "HEAD"), `${parent!.commitId}\n`);
    await store.verifyChain();
    await writeJsonAtomic(join(migrationRoot, "checkpoint.json"), {
      migrationId,
      phase: "replaying",
      completedChapters: commits.length,
      totalChapters: commits.length,
      backupPath,
      updatedAt: new Date().toISOString(),
    });
    await replayStorySystem({ bookDir: params.bookDir, fromChapter: 1, resetDerived: true });
    projectionDiffs = await compareLegacyProjectionFiles(storyDir, {
      "current_state.md": currentState,
      "pending_hooks.md": hooks,
      "chapter_summaries.md": chapterSummaries,
      "particle_ledger.md": ledger,
      "subplot_board.md": subplots,
      "emotional_arcs.md": emotionalArcs,
      "character_matrix.md": characterMatrix,
    });
  }

  const reportPath = join(migrationRoot, "report.json");
  const report: StoryMigrationReport = {
    migrationId,
    applied: Boolean(params.apply),
    bookId: params.bookId,
    chapterCount: commits.length,
    commitIds: commits.map((commit) => commit.commitId),
    backupPath,
    reportPath,
    warnings,
    projectionDiffs,
  };
  await writeJsonAtomic(reportPath, report);
  await writeJsonAtomic(join(migrationRoot, "checkpoint.json"), {
    migrationId,
    phase: "complete",
    completedChapters: commits.length,
    totalChapters: commits.length,
    backupPath,
    updatedAt: new Date().toISOString(),
  });
  return report;
}

function extractHeadingTitle(value: string, chapter: number): string {
  return value
    .replace(new RegExp(`^(?:第\\s*${chapter}\\s*章|Chapter\\s+${chapter}\\s*:?)[\\s:：-]*`, "i"), "")
    .trim() || `Chapter ${chapter}`;
}

async function resumeAppliedMigration(params: {
  readonly bookDir: string;
  readonly bookId: string;
  readonly store: ChapterCommitStore;
  readonly migrationId: string;
  readonly reportPath: string;
}): Promise<StoryMigrationReport> {
  const backupPath = join(params.bookDir, ".inoks-story-webnovel", "backups", params.migrationId);
  const backupStoryDir = join(backupPath, "story");
  if (!await stat(backupStoryDir).then(() => true, () => false)) {
    throw new Error(
      `Migration ${params.migrationId} reached HEAD without its required backup; refusing automatic resume.`,
    );
  }
  const commits = (await params.store.listCommits()).filter((commit) => commit.status === "accepted");
  await params.store.verifyChain();
  await replayStorySystem({ bookDir: params.bookDir, fromChapter: 1, resetDerived: true });
  const before = Object.fromEntries(await Promise.all(
    LEGACY_PROJECTION_FILES.map(async (file) => [file, await readText(join(backupStoryDir, file))]),
  ));
  const projectionDiffs = await compareLegacyProjectionFiles(
    join(params.bookDir, "story"),
    before,
  );
  const report: StoryMigrationReport = {
    migrationId: params.migrationId,
    applied: true,
    bookId: params.bookId,
    chapterCount: new Set(commits.map((commit) => commit.chapter)).size,
    commitIds: commits.map((commit) => commit.commitId),
    backupPath,
    reportPath: params.reportPath,
    warnings: [
      "Resumed an interrupted migration from the accepted commit chain and backup.",
      "Legacy history has no per-chapter event provenance; current facts and hooks are bootstrapped on the final legacy commit.",
    ],
    projectionDiffs,
  };
  await writeJsonAtomic(params.reportPath, report);
  await writeJsonAtomic(join(dirname(params.reportPath), "checkpoint.json"), {
    migrationId: params.migrationId,
    phase: "complete",
    completedChapters: report.chapterCount,
    totalChapters: report.chapterCount,
    backupPath,
    updatedAt: new Date().toISOString(),
  });
  return report;
}

const LEGACY_PROJECTION_FILES = [
  "current_state.md",
  "pending_hooks.md",
  "chapter_summaries.md",
  "particle_ledger.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "character_matrix.md",
] as const;

async function compareLegacyProjectionFiles(
  storyDir: string,
  before: Readonly<Record<string, string>>,
): Promise<StoryMigrationReport["projectionDiffs"]> {
  return Promise.all(LEGACY_PROJECTION_FILES.map(async (file) => {
    const beforeValue = before[file] ?? "";
    const afterValue = await readText(join(storyDir, file));
    const beforeHash = sha256(beforeValue);
    const afterHash = sha256(afterValue);
    return {
      file: `story/${file}`,
      beforeHash,
      afterHash,
      matches: beforeHash === afterHash,
    };
  }));
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf-8").catch(() => "");
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, "utf-8");
  await rename(temp, path);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

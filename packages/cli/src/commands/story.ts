import { Command } from "commander";
import {
  ChapterCommitStore,
  createDefaultProjectionManager,
  latestProjectionFailures,
  migrateLegacyStorySystem,
  repairStorySystem,
  replayStorySystem,
  runStorySystemPreflight,
} from "@inoks-story-webnovel/core";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";
import { StateManager } from "@inoks-story-webnovel/core";

export const storyCommand = new Command("story")
  .description("Verify, replay, repair, and migrate ChapterCommit story history");

storyCommand
  .command("status")
  .argument("[book-id]")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, options: { json?: boolean }) => {
    await runStoryCommand(options.json, async () => {
      const context = await resolveStoryContext(bookIdArg);
      const store = new ChapterCommitStore(context.bookDir);
      const [head, commits, failures] = await Promise.all([
        store.loadHead(),
        store.listCommits(),
        latestProjectionFailures(context.bookDir),
      ]);
      return {
        bookId: context.bookId,
        headCommitId: head?.commitId ?? null,
        headChapter: Number(head?.provenance.canonicalHeadChapter ?? head?.chapter ?? 0),
        acceptedCommits: commits.filter((commit) => commit.status === "accepted").length,
        projectionFailures: failures,
      };
    });
  });

storyCommand
  .command("verify")
  .argument("[book-id]")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, options: { json?: boolean }) => {
    await runStoryCommand(options.json, async () => {
      const context = await resolveStoryContext(bookIdArg);
      return runStorySystemPreflight({
        bookDir: context.bookDir,
        strict: true,
        blockOnProjectionFailure: true,
      });
    });
  });

storyCommand
  .command("replay")
  .argument("[book-id]")
  .option("--from <chapter>", "Replay from chapter", "1")
  .option("--to <chapter>", "Replay through chapter")
  .option("--reset", "Delete derived projections before full replay")
  .option("--json", "Output JSON")
  .action(async (
    bookIdArg: string | undefined,
    options: { from: string; to?: string; reset?: boolean; json?: boolean },
  ) => {
    await runStoryCommand(options.json, async () => {
      const context = await resolveStoryContext(bookIdArg);
      const fromChapter = positiveInteger(options.from, "from");
      const toChapter = options.to ? positiveInteger(options.to, "to") : undefined;
      const results = await replayStorySystem({
        bookDir: context.bookDir,
        fromChapter,
        toChapter,
        resetDerived: Boolean(options.reset),
      });
      return { bookId: context.bookId, fromChapter, toChapter, results };
    });
  });

storyCommand
  .command("repair")
  .argument("[book-id]")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, options: { json?: boolean }) => {
    await runStoryCommand(options.json, async () => {
      const context = await resolveStoryContext(bookIdArg);
      const failuresBefore = await latestProjectionFailures(context.bookDir);
      const repair = failuresBefore.length > 0
        ? await repairStorySystem(context.bookDir)
        : { results: [], completedTransactions: [] };
      const verification = await runStorySystemPreflight({
        bookDir: context.bookDir,
        strict: true,
        blockOnProjectionFailure: true,
      });
      return { bookId: context.bookId, failuresBefore, ...repair, verification };
    });
  });

storyCommand
  .command("rebuild-index")
  .argument("[book-id]")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, options: { json?: boolean }) => {
    await runStoryCommand(options.json, async () => {
      const context = await resolveStoryContext(bookIdArg);
      const store = new ChapterCommitStore(context.bookDir);
      const commits = await store.listCommits();
      const projector = createDefaultProjectionManager(context.bookDir);
      const results = [];
      for (const commit of commits) {
        if (commit.status !== "accepted") continue;
        results.push(...await projector.project(commit, new Set(["retrievalIndex"])));
      }
      return { bookId: context.bookId, results };
    });
  });

storyCommand
  .command("migrate")
  .argument("[book-id]")
  .option("--apply", "Back up the book and switch authority to ChapterCommit")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, options: { apply?: boolean; json?: boolean }) => {
    await runStoryCommand(options.json, async () => {
      const context = await resolveStoryContext(bookIdArg);
      return migrateLegacyStorySystem({
        projectRoot: context.root,
        bookDir: context.bookDir,
        bookId: context.bookId,
        apply: Boolean(options.apply),
      });
    });
  });

async function resolveStoryContext(bookIdArg?: string): Promise<{
  readonly root: string;
  readonly bookId: string;
  readonly bookDir: string;
}> {
  const root = findProjectRoot();
  const bookId = await resolveBookId(bookIdArg, root);
  const state = new StateManager(root);
  return { root, bookId, bookDir: state.bookDir(bookId) };
}

async function runStoryCommand(json: boolean | undefined, action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    log(json ? JSON.stringify(result, null, 2) : formatHuman(result));
  } catch (error) {
    logError(`Story command failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function formatHuman(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

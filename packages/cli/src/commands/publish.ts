import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  exportPublicationPackage,
  importExternalPublicationLog,
  PublicationStore,
  StateManager,
  type PublicationPlatform,
  type PublicationStatus,
} from "@inoks-story-webnovel/core";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

export const publishCommand = new Command("publish")
  .description("Export accepted ChapterCommits and track external publication");

publishCommand
  .command("export")
  .argument("[book-id]")
  .requiredOption("--platform <platform>", "fanqie or qidian")
  .option("--format <format>", "zip, md, or txt", "zip")
  .option("--chapter-format <format>", "md or txt inside ZIP", "md")
  .option("--from <chapter>")
  .option("--to <chapter>")
  .option("--output <path>")
  .option("--json")
  .action(async (bookIdArg: string | undefined, options) => run(options.json, async () => {
    const context = await publicationContext(bookIdArg);
    return exportPublicationPackage({
      ...context,
      platform: platform(options.platform),
      format: oneOf(options.format, ["zip", "md", "txt"], "format"),
      chapterFileFormat: oneOf(options.chapterFormat, ["md", "txt"], "chapter-format"),
      fromChapter: optionalPositiveInteger(options.from, "from"),
      toChapter: optionalPositiveInteger(options.to, "to"),
      outputPath: options.output,
    });
  }));

publishCommand
  .command("status")
  .argument("[book-id]")
  .option("--platform <platform>")
  .option("--json")
  .action(async (bookIdArg: string | undefined, options) => run(options.json, async () => {
    const context = await publicationContext(bookIdArg);
    return new PublicationStore(context.bookDir).list(
      options.platform ? platform(options.platform) : undefined,
    );
  }));

publishCommand
  .command("mark")
  .argument("[book-id]")
  .requiredOption("--platform <platform>")
  .requiredOption("--chapter <chapter>")
  .requiredOption("--commit <commit-id>")
  .requiredOption("--status <status>")
  .option("--log <message>")
  .option("--json")
  .action(async (bookIdArg: string | undefined, options) => run(options.json, async () => {
    const context = await publicationContext(bookIdArg);
    return new PublicationStore(context.bookDir).transition({
      platform: platform(options.platform),
      chapterNumber: positiveInteger(options.chapter, "chapter"),
      chapterCommitId: options.commit,
      status: publicationStatus(options.status),
      externalLog: options.log,
    });
  }));

publishCommand
  .command("import-log")
  .argument("[book-id]")
  .requiredOption("--platform <platform>")
  .requiredOption("--file <path>")
  .option("--json")
  .action(async (bookIdArg: string | undefined, options) => run(options.json, async () => {
    const context = await publicationContext(bookIdArg);
    return importExternalPublicationLog({
      bookDir: context.bookDir,
      platform: platform(options.platform),
      log: await readFile(options.file, "utf-8"),
    });
  }));

async function publicationContext(bookIdArg?: string): Promise<{
  readonly bookId: string;
  readonly bookDir: string;
}> {
  const root = findProjectRoot();
  const bookId = await resolveBookId(bookIdArg, root);
  return { bookId, bookDir: new StateManager(root).bookDir(bookId) };
}

async function run(json: boolean | undefined, action: () => Promise<unknown>): Promise<void> {
  try {
    const result = await action();
    log(JSON.stringify(result, null, 2));
  } catch (error) {
    logError(`Publish command failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function platform(value: string): PublicationPlatform {
  return oneOf(value, ["fanqie", "qidian"], "platform");
}

function publicationStatus(value: string): PublicationStatus {
  return oneOf(value, [
    "exported",
    "handed_to_extension",
    "scheduled_external",
    "published_external",
    "failed_external",
    "status_unknown",
  ], "status");
}

function oneOf<const T extends string>(
  value: string,
  choices: readonly T[],
  name: string,
): T {
  if (!choices.includes(value as T)) throw new Error(`${name} must be one of: ${choices.join(", ")}`);
  return value as T;
}

function optionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  return value === undefined ? undefined : positiveInteger(value, name);
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

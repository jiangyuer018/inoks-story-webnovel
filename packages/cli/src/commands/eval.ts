import { Command } from "commander";
import {
  StateManager,
  AblationRunSchema,
  BlindSceneRatingSchema,
  SceneEvaluationCaseSchema,
  SceneVariantArtifactSchema,
  buildAblationReport,
  buildSceneBlindEvaluationReport,
  evaluateBookQuality,
  saveAblationReport,
  saveSceneBlindEvaluationReport,
} from "@inoks-story-webnovel/core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const evalCommand = new Command("eval")
  .description("Evaluate writing quality for a book — outputs structured quality report")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON only")
  .option("--chapters <range>", "Chapter range (e.g. 1-10, 5-20)")
  .action(async (bookIdArg: string | undefined, opts: { json?: boolean; chapters?: string }) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const result = await evaluateBookQuality({ state, bookId, chapters: opts.chapters });

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(`\nQuality Report: "${bookId}"\n`);
        log(`  Quality Score: ${result.qualityScore}/100`);
        log(`  Chapters: ${result.totalChapters}`);
        log(`  Words: ${result.totalWords.toLocaleString()}`);
        log("");
        log("  Dimensions:");
        log(`    Audit pass rate:      ${result.auditPassRate}%`);
        log(`    AI tell density:      ${result.avgAiTellDensity.toFixed(2)} / 1k chars`);
        log(`    Paragraph warnings:   ${result.avgParagraphWarnings.toFixed(1)} avg/chapter`);
        log(`    Hook resolve rate:    ${result.hookResolveRate}%`);
        log(`    Duplicate titles:     ${result.duplicateTitles}`);
        log("");
        log("  Quality Trend:");
        for (const { chapter, score } of result.qualityTrend) {
          const bar = "█".repeat(Math.round(score / 5)) + "░".repeat(20 - Math.round(score / 5));
          log(`    Ch.${String(chapter).padStart(3)} ${bar} ${score}`);
        }
        log("");

        // Drift detection: compare first half vs second half
        if (result.qualityTrend.length >= 6) {
          const mid = Math.floor(result.qualityTrend.length / 2);
          const firstHalf = result.qualityTrend.slice(0, mid).reduce((s, c) => s + c.score, 0) / mid;
          const secondHalf = result.qualityTrend.slice(mid).reduce((s, c) => s + c.score, 0) / (result.qualityTrend.length - mid);
          const drift = Math.round(secondHalf - firstHalf);
          log(`  Quality Drift: ${drift > 0 ? "+" : ""}${drift} (${drift >= 0 ? "stable/improving" : "DEGRADING"})`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Eval failed: ${e}`);
      }
      process.exit(1);
    }
  });

evalCommand
  .command("ablation")
  .description("Aggregate paired A-H ablation observations without overstating automated metrics")
  .requiredOption("--input <file>", "JSON array of ablation runs, or an object with a runs array")
  .option("--output <file>", "Write the structured report atomically")
  .option("--json", "Output JSON only")
  .action(async (
    options: { input: string; output?: string; json?: boolean },
    command: Command,
  ) => {
    try {
      const source = JSON.parse(await readFile(resolve(options.input), "utf-8")) as unknown;
      const candidates = Array.isArray(source)
        ? source
        : source && typeof source === "object" && Array.isArray((source as { runs?: unknown }).runs)
          ? (source as { runs: unknown[] }).runs
          : null;
      if (!candidates) throw new Error("Ablation input must be a JSON array or { runs: [...] }");
      const runs = AblationRunSchema.array().min(1).parse(candidates);
      const report = buildAblationReport(runs);
      if (options.output) await saveAblationReport(resolve(options.output), report);
      const json = Boolean(options.json || command.optsWithGlobals().json);
      if (json) {
        log(JSON.stringify(report, null, 2));
      } else {
        log(`Ablation report: ${report.interpretationStatus}`);
        log(`Paired samples: ${report.diagnostics.pairedSampleIds.length}`);
        log(`Incomplete samples: ${report.diagnostics.incompleteSampleIds.length}`);
        log(`Human blind ratings complete: ${report.diagnostics.hasHumanBlindRatingsForEveryConfiguration ? "yes" : "no"}`);
        if (options.output) log(`Saved: ${resolve(options.output)}`);
        log(report.disclaimer);
      }
    } catch (error) {
      logError(`Ablation evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

evalCommand
  .command("scene-blind")
  .description("Aggregate the 30-case A/B/C human scene blind review")
  .requiredOption("--input <file>", "JSON object with cases, artifacts, and ratings arrays")
  .option("--output <file>", "Write the structured report atomically")
  .option("--json", "Output JSON only")
  .action(async (
    options: { input: string; output?: string; json?: boolean },
    command: Command,
  ) => {
    try {
      const source = JSON.parse(await readFile(resolve(options.input), "utf-8")) as {
        readonly cases?: unknown;
        readonly artifacts?: unknown;
        readonly ratings?: unknown;
      };
      const report = buildSceneBlindEvaluationReport({
        cases: SceneEvaluationCaseSchema.array().parse(source.cases),
        artifacts: SceneVariantArtifactSchema.array().parse(source.artifacts),
        ratings: BlindSceneRatingSchema.array().parse(source.ratings),
      });
      if (options.output) await saveSceneBlindEvaluationReport(resolve(options.output), report);
      const json = Boolean(options.json || command.optsWithGlobals().json);
      if (json) {
        log(JSON.stringify(report, null, 2));
      } else {
        log(`Scene blind review: ${report.interpretationStatus}`);
        log(`Cases: ${report.caseCount}/30; artifacts: ${report.artifactCount}; ratings: ${report.ratingCount}`);
        log(`Human conclusion: ${report.humanConclusion}`);
        log(`Missing variants: ${report.diagnostics.missingVariants.length}`);
        log(`Unrated artifacts: ${report.diagnostics.unratedArtifacts.length}`);
        if (options.output) log(`Saved: ${resolve(options.output)}`);
        log(report.disclaimer);
      }
    } catch (error) {
      logError(`Scene blind evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

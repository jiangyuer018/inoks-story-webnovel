import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { scanProseQuality } from "./scanner.js";
import type {
  ProseQualityConfig,
  ProseQualityContinuityResult,
  ProseQualityGateResult,
  ProseQualityIssue,
  ProseQualityProfile,
  ProseQualityReport,
  TextDiffStats,
} from "./types.js";

const ZERO_USAGE: ProseQualityReport["tokenUsage"] = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export class ProseQualityGateError extends Error {
  readonly code = "PROSE_QUALITY_GATE_REJECTED";

  constructor(
    message: string,
    readonly result: ProseQualityGateResult,
  ) {
    super(message);
    this.name = "ProseQualityGateError";
  }
}

export async function runProseQualityGate(params: {
  readonly content: string;
  readonly projectRoot: string;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly language: "zh" | "en";
  readonly profile: ProseQualityProfile;
  readonly config: ProseQualityConfig;
  readonly naturalize?: (input: {
    readonly content: string;
    readonly issues: ReadonlyArray<ProseQualityIssue>;
    readonly iteration: number;
  }) => Promise<{
    readonly content: string;
    readonly tokenUsage?: ProseQualityReport["tokenUsage"];
  }>;
  readonly auditContinuity?: (content: string) => Promise<ProseQualityContinuityResult>;
  readonly now?: () => Date;
  readonly priorReport?: ProseQualityReport;
  readonly originalContent?: string;
}): Promise<ProseQualityGateResult> {
  const startedAt = Date.now();
  const now = params.now?.() ?? new Date();
  const whitelist = await loadProseQualityWhitelist(params.projectRoot, params.bookDir);
  const initialScan = params.config.enabled && params.language === "zh"
    ? scanProseQuality(params.content, { language: params.language, whitelist })
    : scanProseQuality(params.content, { language: params.language, whitelist });
  const reportsDir = join(params.bookDir, "quality", "prose");
  const reportPath = join(reportsDir, `chapter-${String(params.chapterNumber).padStart(4, "0")}.json`);
  let content = params.content;
  let currentScan = initialScan;
  let baselineContinuity: ProseQualityContinuityResult | undefined;
  let totalUsage: ProseQualityReport["tokenUsage"] = params.priorReport
    ? { ...params.priorReport.tokenUsage }
    : { ...ZERO_USAGE };
  const iterationOffset = params.priorReport?.iterations.length ?? 0;
  const iterations: ProseQualityReport["iterations"][number][] = [
    ...(params.priorReport?.iterations ?? []),
  ];
  let selectedVersion = params.priorReport?.selectedVersion ?? 0;
  let rolledBack = params.priorReport?.rolledBack ?? false;

  const disabled = !params.config.enabled || !params.config.applyTo.includes(params.profile);
  const shouldRepair = !disabled
    && params.config.enforcement !== "report-only"
    && params.config.autoRepair
    && Boolean(params.naturalize)
    && (currentScan.blockingCount > 0 || currentScan.level === "heavy" || currentScan.score < params.config.minimumScore);

  if (shouldRepair && params.auditContinuity) {
    baselineContinuity = await params.auditContinuity(content);
    totalUsage = addUsage(totalUsage, baselineContinuity.tokenUsage);
  }

  if (shouldRepair) {
    const maxIterations = Math.max(0, Math.min(2, Math.floor(params.config.maxRepairIterations)));
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const revised = await params.naturalize!({
        content,
        issues: currentScan.issues,
        iteration,
      });
      totalUsage = addUsage(totalUsage, revised.tokenUsage);
      if (!revised.content.trim() || revised.content === content) break;

      const nextScan = scanProseQuality(revised.content, { language: params.language, whitelist });
      const diff = computeTextDiffStats(content, revised.content);
      const continuity = params.auditContinuity ? await params.auditContinuity(revised.content) : undefined;
      totalUsage = addUsage(totalUsage, continuity?.tokenUsage);
      const deletionLimit = deletionLimitFor(currentScan.level);
      const continuityWorsened = Boolean(
        continuity && (
          !continuity.passed
          || continuity.blockingCount > (baselineContinuity?.blockingCount ?? 0)
        )
      );
      const improved = nextScan.blockingCount < currentScan.blockingCount
        || (nextScan.blockingCount === currentScan.blockingCount
          && nextScan.score > currentScan.score
          && advisoryDensity(nextScan) <= advisoryDensity(currentScan));
      const accepted = diff.deletionRatio <= deletionLimit
        && diff.modificationRatio <= params.config.maxAutomaticModificationRatio
        && !continuityWorsened
        && improved;
      const reason = diff.deletionRatio > deletionLimit ? "deletion-ratio-exceeded"
        : diff.modificationRatio > params.config.maxAutomaticModificationRatio ? "modification-ratio-exceeded"
          : continuityWorsened ? "continuity-regressed"
            : !improved ? "no-net-quality-improvement"
              : "accepted";
      iterations.push({ iteration: iterationOffset + iteration, scan: nextScan, diff, continuity, accepted, reason });
      if (!accepted) {
        rolledBack = true;
        break;
      }
      content = revised.content;
      currentScan = nextScan;
      baselineContinuity = continuity ?? baselineContinuity;
      selectedVersion = iterationOffset + iteration;
      if (currentScan.blockingCount === 0 && currentScan.score >= params.config.minimumScore) break;
    }
  }

  const strictReject = !disabled
    && params.config.enforcement === "strict"
    && params.config.failOnUnresolvedBlocking
    && currentScan.blockingCount > 0;
  const finalStatus: ProseQualityReport["finalStatus"] = disabled ? "disabled"
    : strictReject ? "rejected"
      : currentScan.blockingCount > 0 ? "warning"
        : "passed";
  const report: ProseQualityReport = {
    ruleVersion: currentScan.ruleVersion,
    chapterNumber: params.chapterNumber,
    profile: params.profile,
    enforcement: params.config.enforcement,
    initialScan: params.priorReport?.initialScan ?? initialScan,
    iterations,
    finalScan: currentScan,
    selectedVersion,
    rolledBack,
    modificationRatio: computeTextDiffStats(params.originalContent ?? params.content, content).modificationRatio,
    tokenUsage: totalUsage,
    unresolvedIssues: currentScan.issues,
    finalStatus,
    originalHash: params.priorReport?.originalHash ?? sha256(params.originalContent ?? params.content),
    finalHash: sha256(content),
    durationMs: Date.now() - startedAt,
    createdAt: now.toISOString(),
  };
  await writeJsonAtomic(reportPath, report);

  let rejectedDraftPath: string | undefined;
  if (strictReject && params.config.saveRejectedDraft) {
    const rejectedDir = join(params.bookDir, ".inoks-story-webnovel", "rejected-drafts", `chapter-${String(params.chapterNumber).padStart(4, "0")}`);
    rejectedDraftPath = join(rejectedDir, "draft.md");
    await mkdir(rejectedDir, { recursive: true });
    await writeFile(rejectedDraftPath, `# 第${params.chapterNumber}章 ${params.title}\n\n${content}`, "utf-8");
    await writeJsonAtomic(join(rejectedDir, "prose-quality-report.json"), report);
  }

  const result: ProseQualityGateResult = {
    content,
    scan: currentScan,
    repaired: selectedVersion > 0,
    iterations: selectedVersion,
    report,
    reportPath,
    rejectedDraftPath,
    tokenUsage: totalUsage,
  };
  if (strictReject) {
    throw new ProseQualityGateError(
      `第${params.chapterNumber}章正文质量门仍有 ${currentScan.blockingCount} 个阻断问题；草稿未正式提交。${rejectedDraftPath ? ` 草稿：${rejectedDraftPath}` : ""}`,
      result,
    );
  }
  return result;
}

export function computeTextDiffStats(original: string, revised: string): TextDiffStats {
  const left = tokenize(original);
  const right = tokenize(revised);
  const common = lcsLength(left, right);
  const deleted = left.length - common;
  const inserted = right.length - common;
  return {
    originalTokens: left.length,
    revisedTokens: right.length,
    commonTokens: common,
    deletedTokens: deleted,
    insertedTokens: inserted,
    deletionRatio: left.length === 0 ? 0 : deleted / left.length,
    modificationRatio: Math.max(left.length, right.length) === 0
      ? 0
      : (deleted + inserted) / Math.max(left.length, right.length),
  };
}

export async function loadProseQualityWhitelist(projectRoot: string, bookDir: string): Promise<string[]> {
  const paths = [
    join(projectRoot, ".inoks-story-webnovel", "prose-quality-whitelist.txt"),
    join(bookDir, "story", "prose_quality_whitelist.txt"),
  ];
  const values = await Promise.all(paths.map((path) => readFile(path, "utf-8").catch(() => "")));
  return [...new Set(values.flatMap((value) => value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("#"))))];
}

function tokenize(text: string): string[] {
  const raw = text.match(/[\u4e00-\u9fff]+|[A-Za-z0-9]+|[^\s]/g) ?? [];
  return raw.flatMap((token) => {
    if (!/^[\u4e00-\u9fff]+$/.test(token)) return [token.toLowerCase()];
    const pairs: string[] = [];
    for (let index = 0; index < token.length; index += 2) pairs.push(token.slice(index, index + 2));
    return pairs;
  });
}

function lcsLength(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  const previous = new Uint32Array(right.length + 1);
  const current = new Uint32Array(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1]! + 1
        : Math.max(previous[rightIndex]!, current[rightIndex - 1]!);
    }
    previous.set(current);
    current.fill(0);
  }
  return previous[right.length] ?? 0;
}

function deletionLimitFor(level: "clean" | "light" | "medium" | "heavy"): number {
  if (level === "heavy") return 0.35;
  if (level === "medium") return 0.25;
  return 0.15;
}

function advisoryDensity(scan: { advisoryCount: number; metrics: Record<string, number> }): number {
  return scan.advisoryCount / Math.max(1, (scan.metrics.visibleChars ?? 1000) / 1000);
}

function addUsage(
  left: ProseQualityReport["tokenUsage"],
  right?: ProseQualityReport["tokenUsage"],
): ProseQualityReport["tokenUsage"] {
  if (!right) return left;
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}

import type { AuditIssue } from "../agents/continuity.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import type { StateManager } from "../state/manager.js";
import { persistChapterArtifacts } from "../pipeline/chapter-persistence.js";
import {
  ChapterApprovalStore,
  approveChapterCommit,
  commitChapterTransaction,
  createDefaultProjectionManager,
  markTransactionPhase,
  type LongFormMemoryConfig,
} from "../story-system/index.js";
import type { ChapterPipelineResult } from "./types.js";

export interface ApprovePendingChapterParams {
  readonly state: StateManager;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly language: LengthLanguage;
  readonly longFormMemory: LongFormMemoryConfig;
  readonly markBookActiveIfNeeded: () => Promise<void>;
  readonly persistAuditDriftGuidance: (issues: ReadonlyArray<AuditIssue>) => Promise<void>;
  readonly logSnapshotStage: () => void;
}

/**
 * Completes the human-approval boundary without acquiring a book lock.
 * PipelineRunner owns the lock so every public entry point keeps one lock scope.
 */
export async function approvePendingChapter(
  params: ApprovePendingChapterParams,
): Promise<ChapterPipelineResult> {
  const bookDir = params.state.bookDir(params.bookId);
  const approvalStore = new ChapterApprovalStore(bookDir);
  const pending = await approvalStore.load(params.chapterNumber);
  if (!pending) {
    throw new Error(
      `Pending chapter ${params.chapterNumber} was not found at ${approvalStore.recordPath(params.chapterNumber)}`,
    );
  }
  if (pending.record.lifecycleStatus !== "awaiting-human-approval") {
    throw new Error(
      `Chapter ${params.chapterNumber} is ${pending.record.lifecycleStatus}; it must be reviewed again before approval`,
    );
  }

  const approved = await approvalStore.markApproved(
    params.chapterNumber,
    pending.record.contentHash,
  );
  await approvalStore.markLifecycle(params.chapterNumber, "commit-pending");
  const commit = approveChapterCommit({
    commit: approved.record.commitDraft,
    approvedContentHash: approved.record.contentHash,
    approvedAt: approved.record.approvedAt,
  });
  const heading = params.language === "en"
    ? `# Chapter ${params.chapterNumber}: ${approved.record.title}`
    : `# 第${params.chapterNumber}章 ${approved.record.title}`;
  const chapterDocument = `${heading}\n\n${approved.content}`;
  let transaction: Awaited<ReturnType<typeof commitChapterTransaction>> | undefined;
  try {
    await persistChapterArtifacts({
      chapterNumber: params.chapterNumber,
      chapterTitle: approved.record.title,
      status: "committed",
      auditResult: approved.record.auditResult,
      finalWordCount: approved.record.finalWordCount,
      lengthWarnings: approved.record.lengthWarnings,
      lengthTelemetry: approved.record.lengthTelemetry,
      degradedIssues: approved.record.degradedIssues,
      tokenUsage: approved.record.tokenUsage,
      proseQuality: approved.record.proseQuality,
      approval: {
        contentHash: approved.record.contentHash,
        approvedContentHash: approved.record.contentHash,
        approvedAt: approved.record.approvedAt,
      },
      loadChapterIndex: () => params.state.loadChapterIndex(params.bookId),
      saveChapter: async () => {
        transaction = await commitChapterTransaction({
          bookDir,
          commit,
          chapterDocument,
        });
      },
      saveTruthFiles: async () => {
        if (!transaction) throw new Error("Chapter transaction was not prepared before projection");
        await markTransactionPhase(transaction.manifestPath, "projecting");
        const projectionResults = await createDefaultProjectionManager(bookDir, {
          sequenceSize: params.longFormMemory.sequenceSize,
          generateSequenceSummaries: params.longFormMemory.generateSequenceSummaries,
          generateArcSummaries: params.longFormMemory.generateArcSummaries,
        }).project(commit);
        const failures = projectionResults.filter((result) => result.status === "failed");
        if (failures.length > 0 && params.longFormMemory.blockOnProjectionFailure) {
          throw new Error(
            `Chapter committed but required projection failed: ${failures
              .map((item) => `${item.name}: ${item.error ?? "failed"}`)
              .join("; ")}`,
          );
        }
        await markTransactionPhase(transaction.manifestPath, "complete");
      },
      saveChapterIndex: (index) => params.state.saveChapterIndex(params.bookId, index),
      markBookActiveIfNeeded: params.markBookActiveIfNeeded,
      persistAuditDriftGuidance: (issues) => params.persistAuditDriftGuidance(issues).catch(() => undefined),
      snapshotState: () => params.state.snapshotState(params.bookId, params.chapterNumber),
      syncCurrentStateFactHistory: async () => undefined,
      logSnapshotStage: params.logSnapshotStage,
    });
  } catch (error) {
    if (transaction) {
      await approvalStore.markLifecycle(params.chapterNumber, "projection-failed");
      const index = await params.state.loadChapterIndex(params.bookId);
      const existing = index.find((chapter) => chapter.number === params.chapterNumber);
      const failedMeta: ChapterMeta = {
        number: params.chapterNumber,
        title: approved.record.title,
        status: "projection-failed",
        wordCount: approved.record.finalWordCount,
        createdAt: existing?.createdAt ?? approved.record.createdAt,
        updatedAt: nowIso(),
        auditIssues: approved.record.auditResult.issues
          .map((issue) => `[${issue.severity}] ${issue.description}`),
        lengthWarnings: [...approved.record.lengthWarnings],
        lengthTelemetry: approved.record.lengthTelemetry,
        tokenUsage: approved.record.tokenUsage,
        proseQuality: approved.record.proseQuality,
        approval: {
          contentHash: approved.record.contentHash,
          approvedContentHash: approved.record.contentHash,
          approvedAt: approved.record.approvedAt,
        },
      };
      await params.state.saveChapterIndex(
        params.bookId,
        existing
          ? index.map((chapter) => chapter.number === params.chapterNumber ? failedMeta : chapter)
          : [...index, failedMeta],
      );
    } else {
      await approvalStore.markLifecycle(params.chapterNumber, "approved");
    }
    throw error;
  }
  await approvalStore.markLifecycle(params.chapterNumber, "committed");
  return {
    chapterNumber: params.chapterNumber,
    title: approved.record.title,
    wordCount: approved.record.finalWordCount,
    auditResult: approved.record.auditResult,
    revised: approved.record.proseQuality?.repaired ?? false,
    status: "committed",
    lengthWarnings: approved.record.lengthWarnings,
    lengthTelemetry: approved.record.lengthTelemetry,
    tokenUsage: approved.record.tokenUsage,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

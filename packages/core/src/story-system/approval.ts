import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { LengthTelemetry } from "../models/length-governance.js";
import { ChapterCommitSchema, ChapterLifecycleStatusSchema } from "./schemas.js";
import { sha256, validationPassedExceptHumanApproval } from "./commit.js";
import type { ChapterCommit, ChapterLifecycleStatus } from "./types.js";

export const CHAPTER_APPROVAL_SCHEMA_VERSION = "inoks-story-chapter-approval/v1";

export interface PendingChapterApproval {
  readonly schemaVersion: typeof CHAPTER_APPROVAL_SCHEMA_VERSION;
  readonly bookId: string;
  readonly chapter: number;
  readonly title: string;
  readonly lifecycleStatus: ChapterLifecycleStatus;
  readonly contentHash: string;
  readonly reviewedContentHash: string;
  readonly approvedContentHash?: string;
  readonly approvedAt?: string;
  readonly commitDraft: ChapterCommit;
  readonly auditResult: AuditResult;
  readonly finalWordCount: number;
  readonly lengthWarnings: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly degradedIssues: ReadonlyArray<AuditIssue>;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly proseQuality?: ChapterMeta["proseQuality"];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LoadedPendingChapterApproval {
  readonly record: PendingChapterApproval;
  readonly content: string;
  readonly draftPath: string;
  readonly recordPath: string;
}

const AuditIssueSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  category: z.string(),
  description: z.string(),
  suggestion: z.string(),
  repairScope: z.enum(["local", "structural", "unknown"]).optional(),
});

const AuditResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(AuditIssueSchema),
  summary: z.string(),
  parseFailed: z.boolean().optional(),
  overallScore: z.number().optional(),
  tokenUsage: z.object({
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }).optional(),
});

const ProseQualityMetaSchema = z.object({
  score: z.number().min(0).max(100),
  level: z.enum(["clean", "light", "medium", "heavy"]),
  blockingCount: z.number().int().min(0),
  advisoryCount: z.number().int().min(0),
  repaired: z.boolean(),
  iterations: z.number().int().min(0),
  reportPath: z.string(),
});

const PendingChapterApprovalSchema = z.object({
  schemaVersion: z.literal(CHAPTER_APPROVAL_SCHEMA_VERSION),
  bookId: z.string().min(1),
  chapter: z.number().int().min(1),
  title: z.string().min(1),
  lifecycleStatus: ChapterLifecycleStatusSchema,
  contentHash: z.string().length(64),
  reviewedContentHash: z.string().length(64),
  approvedContentHash: z.string().length(64).optional(),
  approvedAt: z.string().datetime().optional(),
  commitDraft: ChapterCommitSchema,
  auditResult: AuditResultSchema,
  finalWordCount: z.number().int().min(0),
  lengthWarnings: z.array(z.string()),
  lengthTelemetry: z.unknown().optional(),
  degradedIssues: z.array(AuditIssueSchema),
  tokenUsage: z.object({
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }).optional(),
  proseQuality: ProseQualityMetaSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ChapterApprovalStore {
  readonly root: string;

  constructor(readonly bookDir: string) {
    this.root = join(bookDir, ".inoks-story-webnovel", "story-system", "approvals");
  }

  chapterDir(chapter: number): string {
    return join(this.root, `chapter-${String(chapter).padStart(4, "0")}`);
  }

  draftPath(chapter: number): string {
    return join(this.chapterDir(chapter), "draft.md");
  }

  recordPath(chapter: number): string {
    return join(this.chapterDir(chapter), "approval.json");
  }

  async hasPending(chapter?: number): Promise<boolean> {
    if (chapter !== undefined) {
      const loaded = await this.load(chapter).catch(() => null);
      return loaded !== null && !isTerminalApprovalStatus(loaded.record.lifecycleStatus);
    }
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(this.root).catch(() => [] as string[]);
    for (const name of names.filter((value) => /^chapter-\d{4}$/.test(value))) {
      const recordPath = join(this.root, name, "approval.json");
      const raw = await readFile(recordPath, "utf-8").catch(() => "");
      if (!raw) continue;
      const record = PendingChapterApprovalSchema.parse(JSON.parse(raw)) as PendingChapterApproval;
      if (!isTerminalApprovalStatus(record.lifecycleStatus)) return true;
    }
    return false;
  }

  async listRecords(): Promise<ReadonlyArray<PendingChapterApproval>> {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(this.root).catch(() => [] as string[]);
    const records: PendingChapterApproval[] = [];
    for (const name of names.filter((value) => /^chapter-\d{4}$/.test(value))) {
      const raw = await readFile(join(this.root, name, "approval.json"), "utf-8").catch(() => "");
      if (!raw) continue;
      records.push(PendingChapterApprovalSchema.parse(JSON.parse(raw)) as PendingChapterApproval);
    }
    return records.sort((left, right) => left.chapter - right.chapter);
  }

  async save(params: {
    readonly record: Omit<PendingChapterApproval, "schemaVersion" | "contentHash" | "createdAt" | "updatedAt"> & {
      readonly createdAt?: string;
    };
    readonly content: string;
  }): Promise<LoadedPendingChapterApproval> {
    const now = new Date().toISOString();
    const contentHash = sha256(params.content);
    if (params.record.reviewedContentHash !== params.record.commitDraft.source.contentHash) {
      throw new Error("Pending approval review hash does not match its ChapterCommit draft");
    }
    if (params.record.lifecycleStatus === "awaiting-human-approval") {
      if (contentHash !== params.record.reviewedContentHash) {
        throw new Error("Only the reviewed content may enter human approval");
      }
      if (!validationPassedExceptHumanApproval(params.record.commitDraft.validation)) {
        throw new Error("Pending approval contains unresolved non-human quality gates");
      }
      if (params.record.commitDraft.validation.humanApprovalPassed !== false) {
        throw new Error("Pending approval ChapterCommit must not already have human approval");
      }
    }
    const record = PendingChapterApprovalSchema.parse({
      ...params.record,
      schemaVersion: CHAPTER_APPROVAL_SCHEMA_VERSION,
      contentHash,
      createdAt: params.record.createdAt ?? now,
      updatedAt: now,
    }) as PendingChapterApproval;
    await writeAtomic(this.draftPath(record.chapter), params.content);
    await writeAtomic(this.recordPath(record.chapter), `${JSON.stringify(record, null, 2)}\n`);
    return {
      record,
      content: params.content,
      draftPath: this.draftPath(record.chapter),
      recordPath: this.recordPath(record.chapter),
    };
  }

  async load(chapter: number): Promise<LoadedPendingChapterApproval | null> {
    const recordPath = this.recordPath(chapter);
    const raw = await readFile(recordPath, "utf-8").catch(() => "");
    if (!raw) return null;
    const record = PendingChapterApprovalSchema.parse(JSON.parse(raw)) as PendingChapterApproval;
    const draftPath = this.draftPath(chapter);
    const content = await readFile(draftPath, "utf-8");
    if (sha256(content) !== record.contentHash) {
      throw new Error(`Pending chapter ${chapter} content hash drifted after review`);
    }
    return { record, content, draftPath, recordPath };
  }

  async markApproved(chapter: number, expectedContentHash: string): Promise<LoadedPendingChapterApproval> {
    const loaded = await this.requireAwaiting(chapter);
    if (loaded.record.contentHash !== expectedContentHash
      || loaded.record.reviewedContentHash !== expectedContentHash) {
      throw new Error("Chapter changed after review; approval was invalidated");
    }
    const now = new Date().toISOString();
    return this.replaceRecord(loaded, {
      lifecycleStatus: "approved",
      approvedContentHash: expectedContentHash,
      approvedAt: now,
      updatedAt: now,
    });
  }

  async markLifecycle(
    chapter: number,
    lifecycleStatus: ChapterLifecycleStatus,
  ): Promise<LoadedPendingChapterApproval> {
    const loaded = await this.load(chapter);
    if (!loaded) throw new Error(`Pending chapter ${chapter} was not found`);
    return this.replaceRecord(loaded, {
      lifecycleStatus,
      updatedAt: new Date().toISOString(),
    });
  }

  async invalidateWithEditedContent(chapter: number, content: string): Promise<LoadedPendingChapterApproval> {
    const loaded = await this.load(chapter);
    if (!loaded) throw new Error(`Pending chapter ${chapter} was not found`);
    const now = new Date().toISOString();
    const next = PendingChapterApprovalSchema.parse({
      ...loaded.record,
      lifecycleStatus: "human-editing",
      contentHash: sha256(content),
      approvedContentHash: undefined,
      approvedAt: undefined,
      updatedAt: now,
    }) as PendingChapterApproval;
    await writeAtomic(loaded.draftPath, content);
    await writeAtomic(loaded.recordPath, `${JSON.stringify(next, null, 2)}\n`);
    return { ...loaded, content, record: next };
  }

  private async requireAwaiting(chapter: number): Promise<LoadedPendingChapterApproval> {
    const loaded = await this.load(chapter);
    if (!loaded) throw new Error(`Pending chapter ${chapter} was not found`);
    if (loaded.record.lifecycleStatus !== "awaiting-human-approval") {
      throw new Error(`Pending chapter ${chapter} is ${loaded.record.lifecycleStatus}, not awaiting approval`);
    }
    return loaded;
  }

  private async replaceRecord(
    loaded: LoadedPendingChapterApproval,
    patch: Partial<PendingChapterApproval>,
  ): Promise<LoadedPendingChapterApproval> {
    const record = PendingChapterApprovalSchema.parse({
      ...loaded.record,
      ...patch,
    }) as PendingChapterApproval;
    await writeAtomic(loaded.recordPath, `${JSON.stringify(record, null, 2)}\n`);
    return { ...loaded, record };
  }
}

function isTerminalApprovalStatus(status: ChapterLifecycleStatus): boolean {
  return status === "committed"
    || status === "rejected"
    || status === "exported"
    || status === "published";
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, value, "utf-8");
  await rename(temp, path);
}

import type { AuditResult } from "../agents/continuity.js";
import type { LengthTelemetry } from "../models/length-governance.js";

export interface TokenUsageSummary {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ChapterPipelineResult {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly status:
    | "awaiting-human-approval"
    | "committed"
    | "projection-failed"
    | "ready-for-review"
    | "audit-failed"
    | "state-degraded";
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly lengthTelemetry?: LengthTelemetry;
  readonly tokenUsage?: TokenUsageSummary;
}

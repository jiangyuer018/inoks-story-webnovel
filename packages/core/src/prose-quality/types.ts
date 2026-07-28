export type ProseIssueSeverity = "blocking" | "advisory" | "info";

export interface ProseQualityIssue {
  readonly id: string;
  readonly ruleId: string;
  readonly severity: ProseIssueSeverity;
  readonly category: string;
  readonly message: string;
  readonly suggestion: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
}

export interface ProseQualityScanResult {
  readonly passed: boolean;
  readonly score: number;
  readonly level: "clean" | "light" | "medium" | "heavy";
  readonly blockingCount: number;
  readonly advisoryCount: number;
  readonly infoCount: number;
  readonly metrics: Record<string, number>;
  readonly issues: ReadonlyArray<ProseQualityIssue>;
  readonly ruleVersion: string;
}

export type ProseQualityEnforcement = "strict" | "balanced" | "report-only";
export type ProseQualityProfile = "chapter" | "short-fiction" | "continuation" | "revision";

export interface ProseQualityConfig {
  readonly enabled: boolean;
  readonly enforcement: ProseQualityEnforcement;
  readonly autoRepair: boolean;
  readonly maxRepairIterations: number;
  readonly minimumScore: number;
  readonly failOnUnresolvedBlocking: boolean;
  readonly saveRejectedDraft: boolean;
  readonly applyTo: ReadonlyArray<ProseQualityProfile>;
  readonly maxAutomaticModificationRatio: number;
}

export const DEFAULT_PROSE_QUALITY_CONFIG: ProseQualityConfig = {
  enabled: true,
  enforcement: "strict",
  autoRepair: true,
  maxRepairIterations: 2,
  minimumScore: 80,
  failOnUnresolvedBlocking: true,
  saveRejectedDraft: true,
  applyTo: ["chapter", "short-fiction", "continuation", "revision"],
  maxAutomaticModificationRatio: 0.45,
};

export interface ProseQualityScanOptions {
  readonly language?: "zh" | "en";
  readonly whitelist?: ReadonlyArray<string>;
}

export interface TextDiffStats {
  readonly originalTokens: number;
  readonly revisedTokens: number;
  readonly commonTokens: number;
  readonly deletedTokens: number;
  readonly insertedTokens: number;
  readonly deletionRatio: number;
  readonly modificationRatio: number;
}

export interface ProseQualityContinuityResult {
  readonly passed: boolean;
  readonly blockingCount: number;
  readonly score?: number;
  readonly issues?: ReadonlyArray<string>;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface ProseQualityGateIteration {
  readonly iteration: number;
  readonly scan: ProseQualityScanResult;
  readonly diff: TextDiffStats;
  readonly continuity?: ProseQualityContinuityResult;
  readonly accepted: boolean;
  readonly reason: string;
}

export interface ProseQualityReport {
  readonly ruleVersion: string;
  readonly chapterNumber: number;
  readonly profile: ProseQualityProfile;
  readonly enforcement: ProseQualityEnforcement;
  readonly initialScan: ProseQualityScanResult;
  readonly iterations: ReadonlyArray<ProseQualityGateIteration>;
  readonly finalScan: ProseQualityScanResult;
  readonly selectedVersion: number;
  readonly rolledBack: boolean;
  readonly modificationRatio: number;
  readonly tokenUsage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly unresolvedIssues: ReadonlyArray<ProseQualityIssue>;
  readonly finalStatus: "passed" | "warning" | "rejected" | "disabled";
  readonly originalHash: string;
  readonly finalHash: string;
  readonly durationMs: number;
  readonly createdAt: string;
}

export interface ProseQualityGateResult {
  readonly content: string;
  readonly scan: ProseQualityScanResult;
  readonly repaired: boolean;
  readonly iterations: number;
  readonly report: ProseQualityReport;
  readonly reportPath: string;
  readonly rejectedDraftPath?: string;
  readonly tokenUsage: ProseQualityReport["tokenUsage"];
}

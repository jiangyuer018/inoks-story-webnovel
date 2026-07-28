/**
 * Compatibility facade for the historical AI-tell API.
 *
 * The canonical deterministic rules now live in prose-quality/scanner.ts so
 * review-cycle callers and the mandatory prose gate cannot drift apart.
 */

import { scanProseQuality } from "../prose-quality/scanner.js";

export interface AITellIssue {
  readonly severity: "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface AITellResult {
  readonly issues: ReadonlyArray<AITellIssue>;
}

type AITellLanguage = "zh" | "en";

export function analyzeAITells(content: string, language: AITellLanguage = "zh"): AITellResult {
  const scan = scanProseQuality(content, { language });
  return {
    issues: scan.issues.map((issue) => ({
      severity: issue.severity === "info" ? "info" : "warning",
      category: issue.category,
      description: `${issue.message}（${issue.line}:${issue.column}）`,
      suggestion: issue.suggestion,
    })),
  };
}

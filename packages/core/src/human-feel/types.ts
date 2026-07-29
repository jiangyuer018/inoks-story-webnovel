export type NarrativeSegmentClass =
  | "D"
  | "A"
  | "T"
  | "E"
  | "N"
  | "X"
  | "O";

export type HumanFeelIssueCategory =
  | "exposition"
  | "decorative-environment"
  | "generic-metaphor"
  | "empty-action"
  | "redundant-thought"
  | "artificial-dialogue"
  | "reaction-coupling"
  | "scene-stagnation"
  | "over-neat-plot"
  | "excessive-explanation";

export interface ClassifiedNarrativeSegment {
  readonly paragraphIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly classification: NarrativeSegmentClass;
  readonly confidence: number;
  readonly reasons: ReadonlyArray<string>;
}

export interface HumanFeelIssue {
  readonly id: string;
  readonly category: HumanFeelIssueCategory;
  readonly severity: "info" | "advisory" | "blocking";
  readonly message: string;
  readonly rationale: string;
  readonly suggestion: string;
  readonly paragraphIndex: number;
  readonly start: number;
  readonly end: number;
  readonly excerpt: string;
}

export interface HumanFeelSuggestion {
  readonly issueId: string;
  readonly action: "delete" | "dramatize" | "local-rewrite" | "add-bridge" | "keep";
  readonly scope: "phrase" | "sentence" | "paragraph" | "adjacent-paragraphs";
  readonly instruction: string;
}

export interface HumanFeelReport {
  readonly score: number;
  readonly segments: ReadonlyArray<ClassifiedNarrativeSegment>;
  readonly expositionIssues: ReadonlyArray<HumanFeelIssue>;
  readonly decorativeEnvironmentIssues: ReadonlyArray<HumanFeelIssue>;
  readonly genericMetaphorIssues: ReadonlyArray<HumanFeelIssue>;
  readonly emptyActionIssues: ReadonlyArray<HumanFeelIssue>;
  readonly redundantThoughtIssues: ReadonlyArray<HumanFeelIssue>;
  readonly artificialDialogueIssues: ReadonlyArray<HumanFeelIssue>;
  readonly reactionCouplingIssues: ReadonlyArray<HumanFeelIssue>;
  readonly sceneStagnationIssues: ReadonlyArray<HumanFeelIssue>;
  readonly overNeatPlotIssues: ReadonlyArray<HumanFeelIssue>;
  readonly excessiveExplanationIssues: ReadonlyArray<HumanFeelIssue>;
  readonly blockingIssues: ReadonlyArray<HumanFeelIssue>;
  readonly suggestions: ReadonlyArray<HumanFeelSuggestion>;
  readonly verdict: "pass" | "revise" | "block";
  readonly metrics: Readonly<Record<string, number>>;
  readonly ruleVersion: string;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface HumanFeelAuditOptions {
  readonly language?: "zh" | "en";
  readonly lockedParagraphs?: ReadonlySet<number>;
  readonly ignoredIssueIds?: ReadonlySet<string>;
}

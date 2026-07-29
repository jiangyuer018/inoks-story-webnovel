export interface PlaceholderDetectionResult {
  readonly placeholders: ReadonlyArray<string>;
  readonly missingFields: ReadonlyArray<string>;
  readonly verdict: "pass" | "block";
}

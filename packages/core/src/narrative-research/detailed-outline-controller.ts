import type { OutlineControlResult } from "../story-spec/types.js";
import type { OutlineControlInput } from "./types.js";

export function evaluateOutlineControl(input: OutlineControlInput): OutlineControlResult {
  const searchable = normalize(input.content);
  const expectedBeatIds = input.beats
    .filter((beat) => beat.status === "active" || beat.status === "pending")
    .map((beat) => beat.id);
  const fulfilledBeatIds: string[] = [];
  const partiallyFulfilledBeatIds: string[] = [];
  const missingBeatIds: string[] = [];
  const evidence: Record<string, ReadonlyArray<string>> = {};

  for (const beat of input.beats) {
    if (!expectedBeatIds.includes(beat.id)) continue;
    const criteria = unique([
      ...beat.completionCriteria,
      ...beat.requiredInputs,
      ...beat.expectedStateChange,
    ]).filter(Boolean);
    const terms = criteria.flatMap(expandEvidenceTerms);
    const hits = unique(terms.filter((term) => searchable.includes(normalize(term))));
    evidence[beat.id] = hits;
    const denominator = Math.max(1, Math.min(terms.length, criteria.length * 2 || 1));
    const ratio = hits.length / denominator;
    if (criteria.length === 0 || ratio >= 0.5) fulfilledBeatIds.push(beat.id);
    else if (ratio >= 0.25) partiallyFulfilledBeatIds.push(beat.id);
    else missingBeatIds.push(beat.id);
  }

  const allowed = new Set((input.allowedStateChanges ?? []).flatMap(expandEvidenceTerms).map(normalize));
  const unexpectedStateChanges = (input.actualStateChanges ?? []).filter((change) => {
    if (allowed.size === 0) return false;
    const terms = expandEvidenceTerms(change).map(normalize);
    return terms.length > 0 && !terms.some((term) => [...allowed].some((item) => item.includes(term) || term.includes(item)));
  });
  const hardMissing = input.beats.some((beat) =>
    beat.strength === "hard" && missingBeatIds.includes(beat.id));
  const hardPartial = input.beats.some((beat) =>
    beat.strength === "hard" && partiallyFulfilledBeatIds.includes(beat.id));
  const verdict: OutlineControlResult["verdict"] = hardMissing
    ? "block"
    : unexpectedStateChanges.length > 0
      ? "replan"
      : hardPartial || missingBeatIds.length > 0
        ? "repair"
        : "continue";
  return {
    expectedBeatIds,
    fulfilledBeatIds,
    partiallyFulfilledBeatIds,
    missingBeatIds,
    unexpectedStateChanges,
    evidence,
    verdict,
  };
}

function expandEvidenceTerms(value: string): ReadonlyArray<string> {
  const compact = normalize(value);
  if (!compact) return [];
  const lexical = value
    .split(/[，。；、：:,.!！?？\s()[\]{}]+/)
    .map(normalize)
    .filter((term) => term.length >= 2);
  if (lexical.length > 1) return unique(lexical);
  if (/^[\p{Script=Han}]+$/u.test(compact) && compact.length > 6) {
    const windows: string[] = [];
    for (let index = 0; index <= compact.length - 4; index += 2) {
      windows.push(compact.slice(index, index + 4));
    }
    return unique(windows);
  }
  return [compact];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

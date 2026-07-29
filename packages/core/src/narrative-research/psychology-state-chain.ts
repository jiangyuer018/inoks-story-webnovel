import type { PsychologyState } from "./types.js";

export interface PsychologyActionCheck {
  readonly passed: boolean;
  readonly characterId: string;
  readonly action: string;
  readonly supportingSignals: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<"trigger" | "judgment-change" | "pressure" | "self-deception" | "motivation">;
}

export function checkActionAgainstPsychology(params: {
  readonly state: PsychologyState;
  readonly action: string;
  readonly trigger?: string;
  readonly judgmentChange?: string;
  readonly forcedPressure?: string;
  readonly selfDeception?: string;
}): PsychologyActionCheck {
  const supportingSignals = [
    params.trigger,
    params.judgmentChange,
    params.forcedPressure,
    params.selfDeception,
    overlaps(params.action, params.state.desire) ? params.state.desire : undefined,
    overlaps(params.action, params.state.fear) ? params.state.fear : undefined,
    overlaps(params.action, params.state.copingStrategy) ? params.state.copingStrategy : undefined,
  ].filter((value): value is string => Boolean(value?.trim()));
  const missing: PsychologyActionCheck["missing"][number][] = [];
  if (!params.trigger) missing.push("trigger");
  if (!params.judgmentChange) missing.push("judgment-change");
  if (!params.forcedPressure) missing.push("pressure");
  if (!params.selfDeception) missing.push("self-deception");
  if (supportingSignals.length === 0) missing.push("motivation");
  return {
    passed: supportingSignals.length > 0,
    characterId: params.state.characterId,
    action: params.action,
    supportingSignals,
    missing,
  };
}

function overlaps(left: string, right: string): boolean {
  const terms = right.split(/[，。；、：:,.!！?？\s]+/).filter((term) => term.length >= 2);
  return terms.some((term) => left.includes(term));
}

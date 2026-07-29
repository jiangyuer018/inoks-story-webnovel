import type { NarrativeConcretenessScore, PlannedStoryEvent } from "./types.js";

export interface ConcretenessPlanFactors {
  readonly readerContractImportance: number;
  readonly mainPlotImportance: number;
  readonly emotionIntensity: number;
  readonly payoffValue: number;
  readonly irreversible: boolean;
  readonly firstAppearance: boolean;
  readonly climax: boolean;
  readonly transitionOnly: boolean;
}

export function calculateConcretenessTarget(factors: ConcretenessPlanFactors): number {
  const weighted = (
    clamp(factors.readerContractImportance) * 0.2
    + clamp(factors.mainPlotImportance) * 0.25
    + clamp(factors.emotionIntensity) * 0.15
    + clamp(factors.payoffValue) * 0.2
    + (factors.irreversible ? 0.08 : 0)
    + (factors.firstAppearance ? 0.04 : 0)
    + (factors.climax ? 0.16 : 0)
    - (factors.transitionOnly ? 0.24 : 0)
  );
  return round(clamp(weighted));
}

export function allocateEventCharBudget(params: {
  readonly chapterCharBudget: number;
  readonly events: ReadonlyArray<PlannedStoryEvent>;
}): ReadonlyMap<string, number> {
  if (params.events.length === 0) return new Map();
  const weights = params.events.map((event) =>
    Math.max(0.05, clamp(event.importance) * 0.55 + clamp(event.concretenessTarget) * 0.45));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return new Map(params.events.map((event, index) => [
    event.id,
    Math.max(80, Math.round(params.chapterCharBudget * (weights[index]! / total))),
  ]));
}

export function analyzeNarrativeConcreteness(params: {
  readonly content: string;
  readonly events: ReadonlyArray<PlannedStoryEvent>;
  readonly plannedBudgets: ReadonlyMap<string, number>;
}): ReadonlyArray<NarrativeConcretenessScore> {
  const scenes = splitScenes(params.content);
  return params.events.map((event) => {
    const terms = eventTerms(event);
    const matchingScenes = scenes.filter((scene) => terms.some((term) => scene.includes(term)));
    const actualCharCount = matchingScenes.reduce((sum, scene) => sum + scene.length, 0);
    const plannedCharBudget = params.plannedBudgets.get(event.id) ?? 0;
    const actualDetailLevel = plannedCharBudget > 0
      ? clamp(actualCharCount / plannedCharBudget)
      : matchingScenes.length > 0 ? 1 : 0;
    const plannedSceneCount = Math.max(1, event.allocatedSceneIds.length);
    const underExpanded = event.importance >= 0.65
      && (actualCharCount < plannedCharBudget * 0.6 || matchingScenes.length < plannedSceneCount);
    const overExpanded = event.importance <= 0.35
      && plannedCharBudget > 0
      && actualCharCount > plannedCharBudget * 1.7;
    return {
      eventId: event.id,
      narrativeImportance: clamp(event.importance),
      plannedDetailLevel: clamp(event.concretenessTarget),
      actualDetailLevel: round(actualDetailLevel),
      plannedSceneCount,
      actualSceneCount: matchingScenes.length,
      plannedCharBudget,
      actualCharCount,
      underExpanded,
      overExpanded,
    };
  });
}

function eventTerms(event: PlannedStoryEvent): ReadonlyArray<string> {
  return [...new Set([
    ...event.actors,
    ...event.targetEntities,
    ...event.expectedEffects,
  ].flatMap((value) => value.split(/[，。；、：:,.!！?？\s]+/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2))];
}

function splitScenes(content: string): ReadonlyArray<string> {
  const explicit = content.split(/\n\s*(?:#{2,}\s+|\*{3,}|-{3,})/).map((item) => item.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;
  return content.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type { WeightedContextItem } from "./types.js";

export interface WeightedContextSelection {
  readonly protected: ReadonlyArray<WeightedContextItem>;
  readonly selected: ReadonlyArray<WeightedContextItem>;
  readonly omittedSourceIds: ReadonlyArray<string>;
  readonly estimatedTokens: number;
}

export function selectWeightedContext(
  items: ReadonlyArray<WeightedContextItem>,
  tokenBudget: number,
): WeightedContextSelection {
  const normalizedBudget = Math.max(0, Math.floor(tokenBudget));
  const protectedItems = items
    .filter((item) => item.weight.requiredForCorrectness)
    .sort(compareContext);
  const optional = items
    .filter((item) => !item.weight.requiredForCorrectness)
    .sort(compareContext);
  const selected: WeightedContextItem[] = [];
  let used = protectedItems.reduce((sum, item) => sum + tokens(item), 0);
  for (const item of optional) {
    const cost = tokens(item);
    if (used + cost > normalizedBudget) continue;
    selected.push(item);
    used += cost;
  }
  const selectedIds = new Set([...protectedItems, ...selected].map((item) => item.weight.sourceId));
  return {
    protected: protectedItems,
    selected,
    omittedSourceIds: items
      .filter((item) => !selectedIds.has(item.weight.sourceId))
      .map((item) => item.weight.sourceId),
    estimatedTokens: used,
  };
}

export function contextPriority(item: WeightedContextItem): number {
  const scopeBoost: Readonly<Record<WeightedContextItem["weight"]["scope"], number>> = {
    scene: 1,
    chapter: 0.9,
    arc: 0.72,
    volume: 0.55,
    book: 0.68,
    history: 0.35,
  };
  return (
    item.weight.authority * 0.4
    + item.weight.relevance * 0.35
    + item.weight.recency * 0.15
    + scopeBoost[item.weight.scope] * 0.1
    + (item.weight.requiredForCorrectness ? 10 : 0)
  );
}

function compareContext(left: WeightedContextItem, right: WeightedContextItem): number {
  return contextPriority(right) - contextPriority(left)
    || left.weight.sourceId.localeCompare(right.weight.sourceId);
}

function tokens(item: WeightedContextItem): number {
  return item.estimatedTokens ?? Math.max(1, Math.ceil(item.content.length / 4));
}

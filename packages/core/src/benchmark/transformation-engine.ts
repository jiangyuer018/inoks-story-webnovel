import { createHash } from "node:crypto";
import type { AbstractNarrativeMechanism, BenchmarkVariant } from "./types.js";

export function generateDifferentiatedVariants(params: {
  readonly mechanism: AbstractNarrativeMechanism;
  readonly bookSeed: string;
  readonly scenes: ReadonlyArray<string>;
  readonly conflictSources: ReadonlyArray<string>;
  readonly relationshipStructures: ReadonlyArray<string>;
  readonly solutionMethods: ReadonlyArray<string>;
  readonly rewards: ReadonlyArray<string>;
  readonly costs: ReadonlyArray<string>;
  readonly count?: number;
}): ReadonlyArray<BenchmarkVariant> {
  const count = Math.max(3, Math.min(8, params.count ?? 3));
  const pick = (values: ReadonlyArray<string>, index: number, fallback: string) =>
    values.length > 0 ? values[index % values.length]! : fallback;
  const variants = Array.from({ length: count }, (_, index) => {
    const scene = pick(params.scenes, index, "本书既有场景");
    const conflictSource = pick(params.conflictSources, index + 1, "人物利益冲突");
    const relationshipStructure = pick(params.relationshipStructures, index + 2, "非一一对应的人物关系");
    const solutionMethod = pick(params.solutionMethods, index + 3, "主角依据已有能力主动解决");
    const reward = pick(params.rewards, index + 4, "获得实际选择权");
    const cost = pick(params.costs, index + 5, "承担新的现实代价");
    const basis = `${params.mechanism.id}:${params.bookSeed}:${scene}:${conflictSource}:${relationshipStructure}:${solutionMethod}:${reward}:${cost}`;
    return {
      id: `variant-${createHash("sha256").update(basis).digest("hex").slice(0, 24)}`,
      mechanismId: params.mechanism.id,
      scene,
      conflictSource,
      relationshipStructure,
      solutionMethod,
      witnessStructure: index % 2 === 0 ? "由受影响者和制度结果共同确认" : "由对手被迫改变行为确认",
      reward,
      cost,
      followUpImpact: `兑现后改变下一阶段资源、关系或风险；不得复用来源细节：${params.mechanism.prohibitedSourceDetails.join("、") || "无"}`,
    };
  });
  return uniqueVariants(variants);
}

function uniqueVariants(values: ReadonlyArray<BenchmarkVariant>): BenchmarkVariant[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

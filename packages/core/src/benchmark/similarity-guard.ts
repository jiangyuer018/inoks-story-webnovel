import type {
  BenchmarkStructureSignature,
  SimilarityFlag,
  SimilarityReport,
} from "./types.js";

interface ComparableStructure {
  readonly eventSequence: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
  readonly relationships: ReadonlyArray<string>;
  readonly sceneFunctions: ReadonlyArray<string>;
  readonly beatSequence: ReadonlyArray<string>;
}

interface OneSourceReport {
  readonly mechanismSimilarity: number;
  readonly expressionSimilarity: number;
  readonly plotSequenceSimilarity: number;
  readonly entitySimilarity: number;
  readonly settingSimilarity: number;
  readonly relationshipSimilarity: number;
  readonly sceneFunctionSimilarity: number;
  readonly beatSequenceSimilarity: number;
  readonly structuralSimilarity: number;
  readonly structureEvidence: ReadonlyArray<string>;
  readonly flaggedPassages: ReadonlyArray<SimilarityFlag>;
}

export function analyzeBenchmarkSimilarity(params: {
  readonly candidate: string;
  readonly sources: ReadonlyArray<{ readonly sourceId: string; readonly text: string }>;
  readonly candidateEvents?: ReadonlyArray<string>;
  readonly sourceEvents?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly candidateEntities?: ReadonlyArray<string>;
  readonly sourceEntities?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly candidateRelationships?: ReadonlyArray<string>;
  readonly candidateSceneFunctions?: ReadonlyArray<string>;
  readonly candidateBeats?: ReadonlyArray<string>;
  readonly sourceSignatures?: Readonly<Record<string, BenchmarkStructureSignature>>;
}): SimilarityReport {
  const candidateStructure: ComparableStructure = {
    eventSequence: params.candidateEvents ?? [],
    entities: params.candidateEntities ?? [],
    relationships: params.candidateRelationships ?? [],
    sceneFunctions: params.candidateSceneFunctions ?? [],
    beatSequence: params.candidateBeats ?? [],
  };
  const reports = params.sources.map((source) => compareOne(
    params.candidate,
    source.text,
    candidateStructure,
    params.sourceSignatures?.[source.sourceId] ?? {
      eventSequence: params.sourceEvents?.[source.sourceId] ?? [],
      entities: params.sourceEntities?.[source.sourceId] ?? [],
      relationships: [],
      sceneFunctions: [],
      beatSequence: [],
    },
  ));
  const max = (select: (report: OneSourceReport) => number) =>
    reports.reduce((value, report) => Math.max(value, select(report)), 0);
  const flaggedPassages = reports.flatMap((report) => report.flaggedPassages);
  const expressionSimilarity = max((report) => report.expressionSimilarity);
  const plotSequenceSimilarity = max((report) => report.plotSequenceSimilarity);
  const entitySimilarity = max((report) => report.entitySimilarity);
  const relationshipSimilarity = max((report) => report.relationshipSimilarity);
  const sceneFunctionSimilarity = max((report) => report.sceneFunctionSimilarity);
  const beatSequenceSimilarity = max((report) => report.beatSequenceSimilarity);
  const structuralSimilarity = max((report) => report.structuralSimilarity);
  const block = expressionSimilarity >= 0.32
    || flaggedPassages.some((flag) => normalize(flag.sourceExcerpt).length >= 18)
    || (
      structuralSimilarity >= 0.8
      && expressionSimilarity >= 0.12
      && (entitySimilarity >= 0.3 || relationshipSimilarity >= 0.75)
    );
  const review = expressionSimilarity >= 0.18
    || structuralSimilarity >= 0.55
    || plotSequenceSimilarity >= 0.55
    || entitySimilarity >= 0.25
    || flaggedPassages.length > 0;
  return {
    mechanismSimilarity: max((report) => report.mechanismSimilarity),
    expressionSimilarity,
    plotSequenceSimilarity,
    entitySimilarity,
    settingSimilarity: max((report) => report.settingSimilarity),
    relationshipSimilarity,
    sceneFunctionSimilarity,
    beatSequenceSimilarity,
    structuralSimilarity,
    structureEvidence: unique(reports.flatMap((report) => report.structureEvidence)),
    flaggedPassages,
    verdict: block ? "block" : review ? "review" : "pass",
    comparedSourceIds: params.sources.map((source) => source.sourceId),
  };
}

function compareOne(
  candidate: string,
  source: string,
  candidateStructure: ComparableStructure,
  sourceStructure: ComparableStructure,
): OneSourceReport {
  const candidateNgrams = ngrams(normalize(candidate), 6);
  const sourceNgrams = ngrams(normalize(source), 6);
  const expressionSimilarity = jaccard(candidateNgrams, sourceNgrams);
  const plotSequenceSimilarity = structuralSequenceSimilarity(
    candidateStructure.eventSequence,
    sourceStructure.eventSequence,
  );
  const sceneFunctionSimilarity = structuralSequenceSimilarity(
    candidateStructure.sceneFunctions,
    sourceStructure.sceneFunctions,
  );
  const beatSequenceSimilarity = structuralSequenceSimilarity(
    candidateStructure.beatSequence,
    sourceStructure.beatSequence,
  );
  const entitySimilarity = jaccard(
    normalizedSet(candidateStructure.entities),
    normalizedSet(sourceStructure.entities),
  );
  const relationshipSimilarity = jaccard(
    taxonomySet(candidateStructure.relationships),
    taxonomySet(sourceStructure.relationships),
  );
  const mechanismSimilarity = round(averageNonEmpty([
    [plotSequenceSimilarity, candidateStructure.eventSequence, sourceStructure.eventSequence],
    [sceneFunctionSimilarity, candidateStructure.sceneFunctions, sourceStructure.sceneFunctions],
    [beatSequenceSimilarity, candidateStructure.beatSequence, sourceStructure.beatSequence],
  ]));
  const structuralSimilarity = round(weightedStructuralScore({
    plotSequenceSimilarity,
    sceneFunctionSimilarity,
    beatSequenceSimilarity,
    relationshipSimilarity,
    entitySimilarity,
  }, candidateStructure, sourceStructure));
  const structureEvidence = [
    plotSequenceSimilarity >= 0.55 ? `事件功能序列重合 ${plotSequenceSimilarity}` : "",
    sceneFunctionSimilarity >= 0.55 ? `场景功能序列重合 ${sceneFunctionSimilarity}` : "",
    beatSequenceSimilarity >= 0.55 ? `Beat 序列重合 ${beatSequenceSimilarity}` : "",
    relationshipSimilarity >= 0.5 ? `关系结构重合 ${relationshipSimilarity}` : "",
    entitySimilarity >= 0.25 ? `实体名称重合 ${entitySimilarity}` : "",
  ].filter(Boolean);
  return {
    mechanismSimilarity,
    expressionSimilarity,
    plotSequenceSimilarity,
    entitySimilarity,
    settingSimilarity: lexicalDimension(candidate, source, /宗门|学院|都市|末世|宫廷|星际|副本|游戏|公司|乡村/g),
    relationshipSimilarity,
    sceneFunctionSimilarity,
    beatSequenceSimilarity,
    structuralSimilarity,
    structureEvidence,
    flaggedPassages: findSharedPassages(candidate, source),
  };
}

function weightedStructuralScore(
  scores: {
    readonly plotSequenceSimilarity: number;
    readonly sceneFunctionSimilarity: number;
    readonly beatSequenceSimilarity: number;
    readonly relationshipSimilarity: number;
    readonly entitySimilarity: number;
  },
  candidate: ComparableStructure,
  source: ComparableStructure,
): number {
  const components: Array<[number, number, ReadonlyArray<string>, ReadonlyArray<string>]> = [
    [scores.plotSequenceSimilarity, 0.28, candidate.eventSequence, source.eventSequence],
    [scores.sceneFunctionSimilarity, 0.26, candidate.sceneFunctions, source.sceneFunctions],
    [scores.beatSequenceSimilarity, 0.24, candidate.beatSequence, source.beatSequence],
    [scores.relationshipSimilarity, 0.14, candidate.relationships, source.relationships],
    [scores.entitySimilarity, 0.08, candidate.entities, source.entities],
  ];
  const available = components.filter(([, , left, right]) => left.length > 0 && right.length > 0);
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
  return totalWeight > 0
    ? available.reduce((sum, [score, weight]) => sum + score * weight, 0) / totalWeight
    : 0;
}

function averageNonEmpty(
  values: ReadonlyArray<readonly [number, ReadonlyArray<string>, ReadonlyArray<string>]>,
): number {
  const available = values.filter(([, left, right]) => left.length > 0 && right.length > 0);
  return available.length > 0
    ? available.reduce((sum, [score]) => sum + score, 0) / available.length
    : 0;
}

function findSharedPassages(candidate: string, source: string): SimilarityFlag[] {
  const normalizedSource = normalize(source);
  const flags: SimilarityFlag[] = [];
  const normalizedCandidate = normalize(candidate);
  if (normalizedCandidate.length >= 18 && normalizedSource.includes(normalizedCandidate)) {
    flags.push({
      candidateExcerpt: candidate.trim(),
      sourceExcerpt: normalizedCandidate,
      start: 0,
      end: candidate.length,
      reason: "候选正文整体是用户提供对标文本中的连续表达",
    });
  }
  for (const match of candidate.matchAll(/[^。！？!?\n]{14,}[。！？!?]?/g)) {
    const sentence = match[0].trim();
    const compact = normalize(sentence);
    if (compact.length < 14) continue;
    let found = "";
    for (let size = Math.min(32, compact.length); size >= 14; size -= 2) {
      for (let start = 0; start <= compact.length - size; start += Math.max(1, Math.floor(size / 3))) {
        const window = compact.slice(start, start + size);
        if (normalizedSource.includes(window)) {
          found = window;
          break;
        }
      }
      if (found) break;
    }
    if (!found) continue;
    flags.push({
      candidateExcerpt: sentence,
      sourceExcerpt: found,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      reason: "连续表达与用户提供的对标文本高度重合",
    });
  }
  return [...new Map(flags.map((flag) => [`${flag.start}:${flag.end}:${flag.sourceExcerpt}`, flag])).values()].slice(0, 20);
}

function structuralSequenceSimilarity(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  return sequenceSimilarity(left.map(structuralTaxonomy), right.map(structuralTaxonomy));
}

function structuralTaxonomy(value: string): string {
  const labels = [
    /冲突|阻力|威胁|争|拒绝|压力上升/.test(value) ? "conflict" : "",
    /发现|线索|证据|秘密|释放信息|揭示/.test(value) ? "information" : "",
    /反转|重构|没想到|原来/.test(value) ? "reversal" : "",
    /决定|选择|主动|人物目标/.test(value) ? "choice" : "",
    /获得|兑现|赢|奖励|压力释放/.test(value) ? "payoff" : "",
    /失去|受伤|死亡|代价/.test(value) ? "cost" : "",
    /关系|盟友|敌人|师徒|夫妻|同事/.test(value) ? "relationship" : "",
    /状态|改变|不可逆|后果/.test(value) ? "state-change" : "",
    /承诺|悬念|未决|钩子/.test(value) ? "promise" : "",
  ].filter(Boolean);
  return labels.length > 0 ? labels.join("+") : normalize(value);
}

function sequenceSimilarity(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rows = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i]![j] = left[i - 1] === right[j - 1]
        ? rows[i - 1]![j - 1]! + 1
        : Math.max(rows[i - 1]![j]!, rows[i]![j - 1]!);
    }
  }
  return round(rows[left.length]![right.length]! / Math.max(left.length, right.length));
}

function lexicalDimension(left: string, right: string, pattern: RegExp): number {
  return jaccard(new Set(left.match(pattern) ?? []), new Set(right.match(pattern) ?? []));
}

function normalizedSet(values: ReadonlyArray<string>): Set<string> {
  return new Set(values.map(normalize).filter(Boolean));
}

function taxonomySet(values: ReadonlyArray<string>): Set<string> {
  return new Set(values.flatMap((value) => structuralTaxonomy(value).split("+")).filter(Boolean));
}

function ngrams(value: string, size: number): Set<string> {
  const values = new Set<string>();
  for (let index = 0; index <= value.length - size; index += 1) values.add(value.slice(index, index + size));
  return values;
}

function jaccard<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return round(intersection / (left.size + right.size - intersection));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function unique<T>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type { SimilarityFlag, SimilarityReport } from "./types.js";

export function analyzeBenchmarkSimilarity(params: {
  readonly candidate: string;
  readonly sources: ReadonlyArray<{ readonly sourceId: string; readonly text: string }>;
  readonly candidateEvents?: ReadonlyArray<string>;
  readonly sourceEvents?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly candidateEntities?: ReadonlyArray<string>;
  readonly sourceEntities?: Readonly<Record<string, ReadonlyArray<string>>>;
}): SimilarityReport {
  const reports = params.sources.map((source) => compareOne(params.candidate, source.text, {
    candidateEvents: params.candidateEvents ?? [],
    sourceEvents: params.sourceEvents?.[source.sourceId] ?? [],
    candidateEntities: params.candidateEntities ?? [],
    sourceEntities: params.sourceEntities?.[source.sourceId] ?? [],
  }));
  const max = (key: keyof Omit<SimilarityReport, "flaggedPassages" | "verdict" | "comparedSourceIds">) =>
    reports.reduce((value, report) => Math.max(value, report[key] as number), 0);
  const flaggedPassages = reports.flatMap((report) => report.flaggedPassages);
  const expressionSimilarity = max("expressionSimilarity");
  const plotSequenceSimilarity = max("plotSequenceSimilarity");
  const entitySimilarity = max("entitySimilarity");
  const block = expressionSimilarity >= 0.32
    || flaggedPassages.some((flag) => normalize(flag.candidateExcerpt).length >= 18)
    || (plotSequenceSimilarity >= 0.78 && entitySimilarity >= 0.45);
  const review = expressionSimilarity >= 0.18
    || plotSequenceSimilarity >= 0.55
    || entitySimilarity >= 0.25
    || flaggedPassages.length > 0;
  return {
    mechanismSimilarity: max("mechanismSimilarity"),
    expressionSimilarity,
    plotSequenceSimilarity,
    entitySimilarity,
    settingSimilarity: max("settingSimilarity"),
    relationshipSimilarity: max("relationshipSimilarity"),
    flaggedPassages,
    verdict: block ? "block" : review ? "review" : "pass",
    comparedSourceIds: params.sources.map((source) => source.sourceId),
  };
}

function compareOne(
  candidate: string,
  source: string,
  structured: {
    readonly candidateEvents: ReadonlyArray<string>;
    readonly sourceEvents: ReadonlyArray<string>;
    readonly candidateEntities: ReadonlyArray<string>;
    readonly sourceEntities: ReadonlyArray<string>;
  },
): Omit<SimilarityReport, "verdict" | "comparedSourceIds"> {
  const candidateNgrams = ngrams(normalize(candidate), 6);
  const sourceNgrams = ngrams(normalize(source), 6);
  const expressionSimilarity = jaccard(candidateNgrams, sourceNgrams);
  const plotSequenceSimilarity = sequenceSimilarity(structured.candidateEvents, structured.sourceEvents);
  const entitySimilarity = jaccard(new Set(structured.candidateEntities), new Set(structured.sourceEntities));
  const flags = findSharedPassages(candidate, source);
  return {
    mechanismSimilarity: plotSequenceSimilarity,
    expressionSimilarity,
    plotSequenceSimilarity,
    entitySimilarity,
    settingSimilarity: lexicalDimension(candidate, source, /宗门|学院|都市|末世|宫廷|星际|副本|游戏|公司|乡村/g),
    relationshipSimilarity: lexicalDimension(candidate, source, /师徒|父子|母女|兄弟|姐妹|夫妻|主仆|敌人|盟友|同学/g),
    flaggedPassages: flags,
  };
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
      const window = compact.slice(0, size);
      if (normalizedSource.includes(window)) {
        found = window;
        break;
      }
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type { PublicMarketSnapshot, PublicRankingEntry } from "./types.js";

export interface PublicMarketSource {
  readonly platform: "fanqie" | "qidian";
  scanPublicMetadata(listName: string): Promise<ReadonlyArray<PublicRankingEntry>>;
}

export async function scanPublicMarket(
  source: PublicMarketSource,
  listName: string,
): Promise<PublicMarketSnapshot> {
  const entries = await source.scanPublicMetadata(listName);
  return {
    platform: source.platform,
    listName,
    capturedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      rank: entry.rank,
      title: entry.title,
      author: entry.author,
      tags: [...entry.tags],
      synopsis: entry.synopsis,
      wordCount: entry.wordCount,
      serialStatus: entry.serialStatus,
      publicUrl: entry.publicUrl,
    })),
    sourcePolicy: "public-metadata-only",
  };
}

export function recommendBenchmarkCandidates(
  snapshot: PublicMarketSnapshot,
  targetTags: ReadonlyArray<string>,
  limit = 10,
): ReadonlyArray<PublicRankingEntry & { readonly relevance: number }> {
  const tags = new Set(targetTags.map(normalize));
  return snapshot.entries
    .map((entry) => {
      const overlap = entry.tags.map(normalize).filter((tag) => tags.has(tag)).length;
      const relevance = overlap * 0.65 + (1 / Math.max(1, entry.rank)) * 0.35;
      return { ...entry, relevance: Math.round(relevance * 1000) / 1000 };
    })
    .sort((left, right) => right.relevance - left.relevance || left.rank - right.rank)
    .slice(0, Math.max(1, limit));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

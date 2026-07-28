import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryDB } from "../state/memory-db.js";
import { ChapterCommitStore } from "./commit.js";
import type { LongFormMemoryConfig, MemoryContextPackage, StoryEvent } from "./types.js";

export async function retrieveLongFormMemory(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly chapterGoal: string;
  readonly outlineNode?: string;
  readonly characters?: ReadonlyArray<string>;
  readonly locations?: ReadonlyArray<string>;
  readonly activeHooks?: ReadonlyArray<string>;
  readonly mustKeep?: ReadonlyArray<string>;
  readonly forbiddenChanges?: ReadonlyArray<string>;
  readonly tokenBudget: number;
  readonly config: LongFormMemoryConfig;
}): Promise<MemoryContextPackage> {
  const db = new MemoryDB(params.bookDir);
  const degraded: string[] = [];
  try {
    const currentFacts = db.getCurrentFacts();
    const characterKnowledge = (params.characters ?? []).flatMap((name) => db.getKnowledgeAt(name, params.chapterNumber));
    const worldRules = db.getFactsByPredicate("worldRule");
    const activeHooks = db.getActiveHooks();
    const recentSummaries = db.getRecentSummaries(params.config.retrieval.recentChapterCount);
    const query = [
      params.chapterGoal,
      params.outlineNode ?? "",
      ...(params.characters ?? []),
      ...(params.locations ?? []),
      ...(params.mustKeep ?? []),
    ].join(" ");
    let historicalEvents: Array<StoryEvent & { sourceCommitId: string; relevanceReason: string }> = [];
    if (params.config.retrieval.useFts) {
      try {
        historicalEvents = db.searchStoryEvents(query, params.config.retrieval.maxHistoricalEvents);
      } catch (error) {
        degraded.push(`FTS unavailable: ${error instanceof Error ? error.message : String(error)}`);
        historicalEvents = db.searchStoryEventsFallback(query, params.config.retrieval.maxHistoricalEvents);
      }
    }
    if (params.config.retrieval.useEmbeddings) degraded.push("Embedding retrieval is optional and not configured; used local retrieval.");
    const relatedSummaries = db.searchSummaries(query, params.config.retrieval.maxRelatedSummaries);
    const relationshipHistory = (params.characters ?? []).flatMap((name, index, names) =>
      names.slice(index + 1).flatMap((other) => db.getRelationshipAt(name, other, params.chapterNumber)));
    const compressed = await readCompressedSummaries(params.bookDir);
    const hardConstraints = [...(params.mustKeep ?? []), ...(params.forbiddenChanges ?? []).map((value) => `禁止变化：${value}`)];
    const packageValue: MemoryContextPackage = {
      protected: { currentFacts, characterKnowledge, worldRules, activeHooks, hardConstraints },
      recent: { recentSummaries },
      retrieved: { historicalEvents, relatedSummaries, relationshipHistory },
      compressed,
      provenance: historicalEvents.map((event) => ({
        sourceChapter: event.chapter,
        sourceCommitId: event.sourceCommitId,
        sourceEventId: event.eventId,
        relevanceReason: event.relevanceReason,
      })),
      diagnostics: {
        tokenBudget: params.tokenBudget,
        estimatedTokens: 0,
        ftsUsed: params.config.retrieval.useFts && degraded.every((message) => !message.startsWith("FTS unavailable")),
        embeddingsUsed: false,
        degraded,
      },
    };
    const bounded = enforceTokenBudget(packageValue, params.tokenBudget, params.config);
    return {
      ...bounded,
      diagnostics: {
        ...bounded.diagnostics,
        estimatedTokens: estimateTokens(bounded),
      },
    };
  } finally {
    db.close();
  }
}

async function readCompressedSummaries(bookDir: string): Promise<MemoryContextPackage["compressed"]> {
  const storyDir = join(bookDir, "story", "summaries");
  const [arcSummary, volumeSummary, bookSummary] = await Promise.all([
    readFile(join(storyDir, "arc-summary.md"), "utf-8").catch(() => undefined),
    readFile(join(storyDir, "volume-summary.md"), "utf-8").catch(() => undefined),
    readFile(join(storyDir, "book-summary.md"), "utf-8").catch(() => undefined),
  ]);
  return { arcSummary, volumeSummary, bookSummary };
}

function enforceTokenBudget(
  value: MemoryContextPackage,
  tokenBudget: number,
  config: LongFormMemoryConfig,
): MemoryContextPackage {
  const protectedTokens = estimateTokens(value.protected);
  if (protectedTokens >= tokenBudget) {
    return {
      ...value,
      recent: { recentSummaries: [] },
      retrieved: { historicalEvents: [], relatedSummaries: [], relationshipHistory: [] },
      compressed: {},
      diagnostics: { ...value.diagnostics, degraded: [...value.diagnostics.degraded, "Protected context alone exceeds token budget."] },
    };
  }
  let result = value;
  const retrievedBudget = Math.floor(tokenBudget * config.retrieval.retrievedTokenRatio);
  const compressedBudget = Math.floor(tokenBudget * config.retrieval.compressedTokenRatio);
  while (estimateTokens(result.retrieved) > retrievedBudget && result.retrieved.historicalEvents.length > 0) {
    result = {
      ...result,
      retrieved: {
        ...result.retrieved,
        historicalEvents: result.retrieved.historicalEvents.slice(0, -1),
      },
    };
  }
  while (estimateTokens(result.retrieved) > retrievedBudget && result.retrieved.relatedSummaries.length > 0) {
    result = {
      ...result,
      retrieved: {
        ...result.retrieved,
        relatedSummaries: result.retrieved.relatedSummaries.slice(0, -1),
      },
    };
  }
  if (estimateTokens(result.compressed) > compressedBudget) {
    result = {
      ...result,
      compressed: truncateCompressed(result.compressed, compressedBudget),
      diagnostics: {
        ...result.diagnostics,
        degraded: [...result.diagnostics.degraded, "Compressed summaries were truncated to the configured partition budget."],
      },
    };
  }
  while (estimateTokens(result) > tokenBudget && result.retrieved.historicalEvents.length > 0) {
    result = {
      ...result,
      retrieved: {
        ...result.retrieved,
        historicalEvents: result.retrieved.historicalEvents.slice(0, -1),
      },
    };
  }
  while (estimateTokens(result) > tokenBudget && result.retrieved.relatedSummaries.length > 0) {
    result = {
      ...result,
      retrieved: {
        ...result.retrieved,
        relatedSummaries: result.retrieved.relatedSummaries.slice(0, -1),
      },
    };
  }
  return result;
}

function truncateCompressed(
  value: MemoryContextPackage["compressed"],
  tokenBudget: number,
): MemoryContextPackage["compressed"] {
  const charBudget = Math.max(0, tokenBudget * 3);
  const entries = [
    ["arcSummary", value.arcSummary],
    ["volumeSummary", value.volumeSummary],
    ["bookSummary", value.bookSummary],
  ] as const;
  let remaining = charBudget;
  const result: { arcSummary?: string; volumeSummary?: string; bookSummary?: string } = {};
  for (const [key, content] of entries) {
    if (!content || remaining <= 0) continue;
    result[key] = content.slice(0, remaining);
    remaining -= result[key]!.length;
  }
  return result;
}

function estimateTokens(value: unknown): number {
  const text = JSON.stringify(value);
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return Math.ceil(cjk * 0.7 + (text.length - cjk) / 4);
}

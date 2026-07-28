/**
 * Temporal memory database for Inoks Story Webnovel truth files.
 *
 * Uses Node.js built-in SQLite (node:sqlite, Node 22+).
 * Stores facts with temporal validity (valid_from/valid_until chapter numbers),
 * enabling precise queries like "what did character X know in chapter 5?"
 *
 * Accepted ChapterCommit records are canonical. This database is a rebuildable
 * temporal projection used for deterministic retrieval.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import type { ChapterCommit, StoryEvent } from "../story-system/types.js";

const require = createRequire(import.meta.url);

const FACT_SELECT_COLUMNS = `
  id,
  subject,
  predicate,
  object,
  valid_from_chapter AS validFromChapter,
  valid_until_chapter AS validUntilChapter,
  source_chapter AS sourceChapter,
  source_commit_id AS sourceCommitId,
  source_event_id AS sourceEventId,
  epistemic_status AS epistemicStatus,
  confidence,
  evidence,
  supersedes_fact_id AS supersedesFactId
`;

export interface Fact {
  readonly id?: number;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly validFromChapter: number;
  readonly validUntilChapter: number | null;
  readonly sourceChapter: number;
  readonly sourceCommitId?: string;
  readonly sourceEventId?: string;
  readonly epistemicStatus?: string;
  readonly confidence?: number;
  readonly evidence?: string;
  readonly supersedesFactId?: number | null;
}

export interface StoredSummary {
  readonly chapter: number;
  readonly title: string;
  readonly characters: string;
  readonly events: string;
  readonly stateChanges: string;
  readonly hookActivity: string;
  readonly mood: string;
  readonly chapterType: string;
}

export interface StoredHook {
  readonly hookId: string;
  readonly startChapter: number;
  readonly type: string;
  readonly status: string;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly payoffTiming?: string;
  readonly notes: string;
  // Phase 7 — hook causality / promotion metadata.
  readonly dependsOn?: ReadonlyArray<string>;
  readonly paysOffInArc?: string;
  readonly coreHook?: boolean;
  readonly halfLifeChapters?: number;
  readonly advancedCount?: number;
  // Phase 7 hotfix 2 — whether the seed has been promoted into the live ledger
  // (architect-time structural rules + consolidator-time advanced_count rule).
  // Reviewer uses this to gate critical-severity escalation.
  readonly promoted?: boolean;
  readonly content?: string;
  readonly targetChapter?: number;
  readonly targetArc?: string;
  readonly urgency?: string;
  readonly relatedCharacters?: ReadonlyArray<string>;
  readonly evidence?: ReadonlyArray<string>;
  readonly closeReason?: string;
}

export interface IndexedStoryEvent extends StoryEvent {
  readonly sourceCommitId: string;
  readonly relevanceReason: string;
}

export class MemoryDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(bookDir: string) {
    // node:sqlite requires Node 22+; require() via createRequire for ESM compat
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = join(bookDir, "story", "memory.db");
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from_chapter INTEGER NOT NULL,
        valid_until_chapter INTEGER,
        source_chapter INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chapter_summaries (
        chapter INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        characters TEXT NOT NULL DEFAULT '',
        events TEXT NOT NULL DEFAULT '',
        state_changes TEXT NOT NULL DEFAULT '',
        hook_activity TEXT NOT NULL DEFAULT '',
        mood TEXT NOT NULL DEFAULT '',
        chapter_type TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS hooks (
        hook_id TEXT PRIMARY KEY,
        start_chapter INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        last_advanced_chapter INTEGER NOT NULL DEFAULT 0,
        expected_payoff TEXT NOT NULL DEFAULT '',
        payoff_timing TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS story_events (
        event_id TEXT PRIMARY KEY,
        chapter INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        object TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 1,
        epistemic_status TEXT NOT NULL DEFAULT 'objective',
        source_excerpt TEXT NOT NULL DEFAULT '',
        source_start INTEGER NOT NULL DEFAULT 0,
        source_end INTEGER NOT NULL DEFAULT 0,
        source_commit_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projected_commits (
        commit_id TEXT PRIMARY KEY,
        chapter INTEGER NOT NULL,
        commit_hash TEXT NOT NULL,
        projected_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(valid_from_chapter, valid_until_chapter);
      CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_chapter);
      CREATE INDEX IF NOT EXISTS idx_hooks_status ON hooks(status);
      CREATE INDEX IF NOT EXISTS idx_hooks_last_advanced ON hooks(last_advanced_chapter);
      CREATE INDEX IF NOT EXISTS idx_story_events_chapter ON story_events(chapter);
      CREATE INDEX IF NOT EXISTS idx_story_events_subject ON story_events(subject);
    `);

    this.ensureColumn("hooks", "payoff_timing", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("hooks", "content", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("hooks", "target_chapter", "INTEGER");
    this.ensureColumn("hooks", "target_arc", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("hooks", "urgency", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("hooks", "depends_on_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("hooks", "related_characters_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("hooks", "evidence_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("hooks", "close_reason", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("facts", "source_commit_id", "TEXT");
    this.ensureColumn("facts", "source_event_id", "TEXT");
    this.ensureColumn("facts", "epistemic_status", "TEXT NOT NULL DEFAULT 'objective'");
    this.ensureColumn("facts", "confidence", "REAL NOT NULL DEFAULT 1");
    this.ensureColumn("facts", "evidence", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("facts", "supersedes_fact_id", "INTEGER");
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS story_events_fts USING fts5(
          event_id UNINDEXED,
          event_type,
          subject,
          object,
          source_excerpt,
          payload
        );
      `);
    } catch {
      // Some bundled SQLite builds omit FTS5. Retrieval has a local fallback.
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists on existing databases.
    }
  }

  // ---------------------------------------------------------------------------
  // Facts (temporal)
  // ---------------------------------------------------------------------------

  /** Add a new fact. */
  addFact(fact: Omit<Fact, "id">): number {
    const stmt = this.db.prepare(
      `INSERT INTO facts (
         subject, predicate, object, valid_from_chapter, valid_until_chapter, source_chapter,
         source_commit_id, source_event_id, epistemic_status, confidence, evidence, supersedes_fact_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(
      fact.subject, fact.predicate, fact.object,
      fact.validFromChapter, fact.validUntilChapter ?? null, fact.sourceChapter,
      fact.sourceCommitId ?? null, fact.sourceEventId ?? null,
      fact.epistemicStatus ?? "objective", fact.confidence ?? 1,
      fact.evidence ?? "", fact.supersedesFactId ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  /** Invalidate a fact (set valid_until). */
  invalidateFact(id: number, untilChapter: number): void {
    this.db.prepare(
      "UPDATE facts SET valid_until_chapter = ? WHERE id = ?",
    ).run(untilChapter, id);
  }

  /** Get all currently valid facts (valid_until is null). */
  getCurrentFacts(): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all() as unknown as Fact[];
  }

  /** Get facts about a specific subject that are valid at a given chapter. */
  getFactsAt(subject: string, chapter: number): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ? AND valid_from_chapter <= ?
       AND (valid_until_chapter IS NULL OR valid_until_chapter > ?)
       ORDER BY predicate`,
    ).all(subject, chapter, chapter) as unknown as Fact[];
  }

  /** Get all facts about a subject (including historical). */
  getFactHistory(subject: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ?
       ORDER BY valid_from_chapter`,
    ).all(subject) as unknown as Fact[];
  }

  /** Search facts by predicate (e.g., all "location" facts). */
  getFactsByPredicate(predicate: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE predicate = ? AND valid_until_chapter IS NULL
       ORDER BY subject`,
    ).all(predicate) as unknown as Fact[];
  }

  /** Get facts relevant to a set of character names. */
  getFactsForCharacters(names: ReadonlyArray<string>): ReadonlyArray<Fact> {
    if (names.length === 0) return [];
    const placeholders = names.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject IN (${placeholders}) AND valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all(...names) as unknown as Fact[];
  }

  getFactsByLocation(location: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE valid_until_chapter IS NULL
       AND (predicate IN ('location', 'currentLocation') OR object = ?)
       AND (subject = ? OR object = ?)
       ORDER BY subject, predicate`,
    ).all(location, location, location) as unknown as Fact[];
  }

  getKnowledgeAt(character: string, chapter: number): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ? AND valid_from_chapter <= ?
       AND (valid_until_chapter IS NULL OR valid_until_chapter > ?)
       AND (lower(predicate) LIKE '%knowledge%' OR predicate LIKE '%知道%' OR predicate LIKE '%认知%')
       ORDER BY valid_from_chapter, predicate`,
    ).all(character, chapter, chapter) as unknown as Fact[];
  }

  getRelationshipAt(a: string, b: string, chapter: number): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE valid_from_chapter <= ?
       AND (valid_until_chapter IS NULL OR valid_until_chapter > ?)
       AND (
         (subject = ? AND object LIKE ?)
         OR (subject = ? AND object LIKE ?)
       )
       AND (lower(predicate) LIKE '%relationship%' OR predicate LIKE '%关系%')
       ORDER BY valid_from_chapter`,
    ).all(chapter, chapter, a, `%${b}%`, b, `%${a}%`) as unknown as Fact[];
  }

  /**
   * Apply one accepted commit as an idempotent temporal projection. Old facts
   * are closed rather than deleted so historical chapter queries remain valid.
   */
  applyCommit(commit: ChapterCommit): void {
    const alreadyProjected = this.db.prepare(
      "SELECT 1 AS present FROM projected_commits WHERE commit_id = ?",
    ).get(commit.commitId) as { present?: number } | undefined;
    if (alreadyProjected) return;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const hasPriorProjection = Boolean(this.db.prepare(
        "SELECT 1 AS present FROM projected_commits LIMIT 1",
      ).get());
      this.indexStoryEvents(commit.events.map((event) => ({ ...event, sourceCommitId: commit.commitId })));
      for (const delta of temporalDeltasForCommit(commit)) {
        const current = this.db.prepare(
          `SELECT id, object FROM facts
           WHERE subject = ? AND predicate = ? AND valid_until_chapter IS NULL
           ORDER BY valid_from_chapter DESC LIMIT 1`,
        ).get(delta.subject, delta.predicate) as { id: number; object: string } | undefined;
        const expectedOldValue = stableValue(delta.oldValue);
        if ((current && current.object !== expectedOldValue)
          || (hasPriorProjection
            && !current
            && delta.oldValue !== null
            && delta.oldValue !== undefined
            && expectedOldValue !== "")) {
          throw new Error(
            `Temporal fact old-value conflict for ${delta.subject}::${delta.predicate}: expected ${expectedOldValue || "<none>"}, got ${current?.object ?? "<none>"}`,
          );
        }
        const nextValue = stableValue(delta.newValue);
        if (current?.object === nextValue) continue;
        if (current) this.invalidateFact(current.id, commit.chapter);
        const sourceEvent = delta.sourceEventId
          ? commit.events.find((event) => event.eventId === delta.sourceEventId)
          : undefined;
        this.addFact({
          subject: delta.subject,
          predicate: delta.predicate,
          object: nextValue,
          validFromChapter: commit.chapter,
          validUntilChapter: null,
          sourceChapter: commit.chapter,
          sourceCommitId: commit.commitId,
          sourceEventId: sourceEvent?.eventId,
          epistemicStatus: sourceEvent?.epistemicStatus ?? "objective",
          confidence: sourceEvent?.confidence ?? 1,
          evidence: sourceEvent?.evidence.join("\n") ?? "",
          supersedesFactId: current?.id ?? null,
        });
      }
      this.db.prepare(
        "INSERT INTO projected_commits (commit_id, chapter, commit_hash) VALUES (?, ?, ?)",
      ).run(commit.commitId, commit.chapter, commit.commitHash);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getLastProjectedCommit(): { readonly commitId: string; readonly chapter: number } | null {
    const row = this.db.prepare(
      `SELECT commit_id AS commitId, chapter
       FROM projected_commits
       ORDER BY rowid DESC LIMIT 1`,
    ).get() as { commitId: string; chapter: number } | undefined;
    return row ?? null;
  }

  replaceCurrentFacts(facts: ReadonlyArray<Omit<Fact, "id">>): void {
    this.db.exec("DELETE FROM facts WHERE valid_until_chapter IS NULL");
    for (const fact of facts) {
      this.addFact(fact);
    }
  }

  resetFacts(): void {
    this.db.exec("DELETE FROM facts");
  }

  // ---------------------------------------------------------------------------
  // Chapter summaries
  // ---------------------------------------------------------------------------

  /** Upsert a chapter summary. */
  upsertSummary(summary: StoredSummary): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO chapter_summaries (chapter, title, characters, events, state_changes, hook_activity, mood, chapter_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      summary.chapter, summary.title, summary.characters, summary.events,
      summary.stateChanges, summary.hookActivity, summary.mood, summary.chapterType,
    );
  }

  replaceSummaries(summaries: ReadonlyArray<StoredSummary>): void {
    this.db.exec("DELETE FROM chapter_summaries");
    for (const summary of summaries) {
      this.upsertSummary(summary);
    }
  }

  /** Get summaries for a range of chapters. */
  getSummaries(fromChapter: number, toChapter: number): ReadonlyArray<StoredSummary> {
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE chapter >= ? AND chapter <= ?
       ORDER BY chapter`,
    ).all(fromChapter, toChapter) as unknown as StoredSummary[];
  }

  /** Get summaries matching any of the given character names. */
  getSummariesByCharacters(names: ReadonlyArray<string>): ReadonlyArray<StoredSummary> {
    if (names.length === 0) return [];
    const conditions = names.map(() => "characters LIKE ?").join(" OR ");
    const params = names.map((n) => `%${n}%`);
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE ${conditions}
       ORDER BY chapter`,
    ).all(...params) as unknown as StoredSummary[];
  }

  /** Get total chapter count. */
  getChapterCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM chapter_summaries").get() as unknown as { count: number };
    return row.count;
  }

  /** Get the most recent N summaries. */
  getRecentSummaries(count: number): ReadonlyArray<StoredSummary> {
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       ORDER BY chapter DESC
       LIMIT ?`,
    ).all(count) as unknown as ReadonlyArray<StoredSummary>;
  }

  searchSummaries(query: string, limit: number): ReadonlyArray<StoredSummary & { readonly relevanceReason: string }> {
    const terms = queryTerms(query);
    const rows = this.db.prepare(
      `SELECT
         chapter, title, characters, events,
         state_changes AS stateChanges, hook_activity AS hookActivity,
         mood, chapter_type AS chapterType
       FROM chapter_summaries ORDER BY chapter DESC`,
    ).all() as unknown as StoredSummary[];
    return rankByTerms(rows, terms, (row) =>
      `${row.title} ${row.characters} ${row.events} ${row.stateChanges} ${row.hookActivity}`)
      .slice(0, limit)
      .map(({ value, matches }) => ({ ...value, relevanceReason: `matched:${matches.join(",")}` }));
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  upsertHook(hook: StoredHook): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO hooks (
         hook_id, start_chapter, type, status, last_advanced_chapter,
         expected_payoff, payoff_timing, notes, content, target_chapter,
         target_arc, urgency, depends_on_json, related_characters_json,
         evidence_json, close_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      hook.payoffTiming ?? "",
      hook.notes,
      hook.content ?? hook.expectedPayoff,
      hook.targetChapter ?? null,
      hook.targetArc ?? hook.paysOffInArc ?? "",
      hook.urgency ?? "",
      JSON.stringify(hook.dependsOn ?? []),
      JSON.stringify(hook.relatedCharacters ?? []),
      JSON.stringify(hook.evidence ?? []),
      hook.closeReason ?? "",
    );
  }

  replaceHooks(hooks: ReadonlyArray<StoredHook>): void {
    this.db.exec("DELETE FROM hooks");
    for (const hook of hooks) {
      this.upsertHook(hook);
    }
  }

  getActiveHooks(): ReadonlyArray<StoredHook> {
    const rows = this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         notes, content, target_chapter AS targetChapter, target_arc AS targetArc,
         urgency, depends_on_json AS dependsOnJson,
         related_characters_json AS relatedCharactersJson,
         evidence_json AS evidenceJson, close_reason AS closeReason
       FROM hooks
       WHERE lower(status) NOT IN ('resolved', 'closed', '已回收', '已解决')
       ORDER BY last_advanced_chapter DESC, start_chapter DESC, hook_id ASC`,
    ).all() as unknown as Array<Record<string, unknown>>;
    return rows.map(normalizeStoredHook);
  }

  getHook(hookId: string): StoredHook | undefined {
    const row = this.db.prepare(
      `SELECT
         hook_id AS hookId, start_chapter AS startChapter, type, status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff, payoff_timing AS payoffTiming, notes,
         content, target_chapter AS targetChapter, target_arc AS targetArc,
         urgency, depends_on_json AS dependsOnJson,
         related_characters_json AS relatedCharactersJson,
         evidence_json AS evidenceJson, close_reason AS closeReason
       FROM hooks WHERE hook_id = ?`,
    ).get(hookId) as Record<string, unknown> | undefined;
    return row ? normalizeStoredHook(row) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Story event retrieval projection
  // ---------------------------------------------------------------------------

  indexStoryEvents(events: ReadonlyArray<StoryEvent & { readonly sourceCommitId: string }>): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO story_events (
         event_id, chapter, event_type, subject, object, payload_json, evidence_json,
         confidence, epistemic_status, source_excerpt, source_start, source_end, source_commit_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      const payloadJson = JSON.stringify(event.payload);
      const result = insert.run(
        event.eventId, event.chapter, event.eventType, event.subject, event.object ?? null,
        payloadJson, JSON.stringify(event.evidence), event.confidence, event.epistemicStatus,
        event.sourceExcerpt, event.sourceStart, event.sourceEnd, event.sourceCommitId,
      );
      if (Number(result.changes) === 0) continue;
      try {
        this.db.prepare(
          `INSERT INTO story_events_fts (
             event_id, event_type, subject, object, source_excerpt, payload
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          event.eventId, event.eventType, event.subject, event.object ?? "",
          event.sourceExcerpt, payloadJson,
        );
      } catch {
        // FTS is optional; the indexed base table remains authoritative.
      }
    }
  }

  searchStoryEvents(query: string, limit: number): Array<IndexedStoryEvent> {
    const terms = queryTerms(query);
    if (terms.length === 0) return this.searchStoryEventsFallback(query, limit);
    const match = terms.map(escapeFtsTerm).join(" OR ");
    const rows = this.db.prepare(
      `SELECT e.*, bm25(story_events_fts) AS rank
       FROM story_events_fts
       JOIN story_events e ON e.event_id = story_events_fts.event_id
       WHERE story_events_fts MATCH ?
       ORDER BY rank, e.chapter DESC LIMIT ?`,
    ).all(match, limit) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => eventFromRow(row, "fts/bm25"));
  }

  searchStoryEventsFallback(query: string, limit: number): Array<IndexedStoryEvent> {
    const terms = queryTerms(query);
    const rows = this.db.prepare(
      "SELECT * FROM story_events ORDER BY chapter DESC LIMIT 1000",
    ).all() as unknown as Array<Record<string, unknown>>;
    return rankByTerms(rows, terms, (row) =>
      `${row.event_type ?? ""} ${row.subject ?? ""} ${row.object ?? ""} ${row.source_excerpt ?? ""} ${row.payload_json ?? ""}`)
      .slice(0, limit)
      .map(({ value, matches }) => eventFromRow(value, `local:${matches.join(",") || "recent"}`));
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}

function stableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function temporalDeltasForCommit(commit: ChapterCommit): Array<{
  readonly subject: string;
  readonly predicate: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly sourceEventId?: string;
}> {
  const values = [...commit.stateDeltas];
  for (const relationship of commit.relationshipDeltas) {
    values.push({
      subject: relationship.fromEntity,
      predicate: `relationship:${relationship.relationshipType}`,
      oldValue: relationship.oldValue,
      newValue: JSON.stringify({
        target: relationship.toEntity,
        value: relationship.newValue,
        status: relationship.operation,
      }),
    });
  }
  for (const event of commit.events) {
    if (event.epistemicStatus !== "objective" || event.confidence < 0.75) continue;
    let predicate: string | undefined;
    const oldValue: unknown = event.payload.oldValue;
    let newValue: unknown;
    if (event.eventType === "location_changed") {
      predicate = "currentLocation";
      newValue = event.payload.to ?? event.payload.newValue ?? event.object;
    } else if (event.eventType === "knowledge_gained" || event.eventType === "knowledge_corrected") {
      predicate = `knowledge:${event.object ?? String(event.payload.topic ?? "fact")}`;
      newValue = event.payload.value ?? event.payload.knowledge ?? event.object;
    } else if (event.eventType === "world_rule_revealed" || event.eventType === "world_rule_broken") {
      predicate = "worldRule";
      newValue = event.payload.rule ?? event.object ?? event.sourceExcerpt;
    } else if (event.eventType === "item_acquired" || event.eventType === "item_lost") {
      predicate = `item:${event.object ?? String(event.payload.item ?? "unknown")}`;
      newValue = event.eventType === "item_acquired"
        ? event.payload.quantity ?? event.payload.value ?? "acquired"
        : "lost";
    }
    if (!predicate || newValue === undefined) continue;
    if (values.some((delta) => delta.subject === event.subject && delta.predicate === predicate)) continue;
    values.push({
      subject: event.subject,
      predicate,
      oldValue,
      newValue,
      sourceEventId: event.eventId,
    });
  }
  return values;
}

function queryTerms(query: string): string[] {
  const latin = query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
  const cjkChunks = query.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  const cjk = cjkChunks.flatMap((chunk) => {
    if (chunk.length <= 4) return [chunk];
    const parts: string[] = [];
    for (let index = 0; index < chunk.length - 1; index += 2) parts.push(chunk.slice(index, index + 2));
    return parts;
  });
  return [...new Set([...latin, ...cjk])].slice(0, 24);
}

function escapeFtsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

function rankByTerms<T>(
  values: ReadonlyArray<T>,
  terms: ReadonlyArray<string>,
  textOf: (value: T) => string,
): Array<{ value: T; matches: string[] }> {
  return values
    .map((value) => {
      const text = textOf(value).toLowerCase();
      return { value, matches: terms.filter((term) => text.includes(term.toLowerCase())) };
    })
    .filter((entry) => terms.length === 0 || entry.matches.length > 0)
    .sort((a, b) => b.matches.length - a.matches.length);
}

function eventFromRow(row: Record<string, unknown>, relevanceReason: string): IndexedStoryEvent {
  return {
    eventId: String(row.event_id ?? ""),
    chapter: Number(row.chapter ?? 0),
    eventType: String(row.event_type ?? ""),
    subject: String(row.subject ?? ""),
    object: row.object == null ? undefined : String(row.object),
    payload: parseRecord(row.payload_json),
    evidence: parseStringArray(row.evidence_json),
    confidence: Number(row.confidence ?? 0),
    epistemicStatus: String(row.epistemic_status ?? "objective") as StoryEvent["epistemicStatus"],
    sourceExcerpt: String(row.source_excerpt ?? ""),
    sourceStart: Number(row.source_start ?? 0),
    sourceEnd: Number(row.source_end ?? 0),
    sourceCommitId: String(row.source_commit_id ?? ""),
    relevanceReason,
  };
}

function parseRecord(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeStoredHook(row: Record<string, unknown>): StoredHook {
  return {
    hookId: String(row.hookId ?? ""),
    startChapter: Number(row.startChapter ?? 0),
    type: String(row.type ?? ""),
    status: String(row.status ?? "open"),
    lastAdvancedChapter: Number(row.lastAdvancedChapter ?? 0),
    expectedPayoff: String(row.expectedPayoff ?? ""),
    payoffTiming: String(row.payoffTiming ?? "") || undefined,
    notes: String(row.notes ?? ""),
    content: String(row.content ?? "") || undefined,
    targetChapter: row.targetChapter == null ? undefined : Number(row.targetChapter),
    targetArc: String(row.targetArc ?? "") || undefined,
    urgency: String(row.urgency ?? "") || undefined,
    dependsOn: parseStringArray(row.dependsOnJson),
    relatedCharacters: parseStringArray(row.relatedCharactersJson),
    evidence: parseStringArray(row.evidenceJson),
    closeReason: String(row.closeReason ?? "") || undefined,
  };
}

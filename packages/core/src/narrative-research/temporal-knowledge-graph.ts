import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, sha256 } from "../story-system/commit.js";
import type { ChapterCommit } from "../story-system/types.js";
import type { TemporalConflict, TemporalFact } from "./types.js";

export class TemporalKnowledgeGraphStore {
  readonly path: string;

  constructor(bookDir: string) {
    this.path = join(bookDir, "story", "state", "temporal-knowledge-graph.json");
  }

  async load(): Promise<ReadonlyArray<TemporalFact>> {
    const raw = await readFile(this.path, "utf-8").catch(() => "[]");
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value as TemporalFact[] : [];
  }

  async projectCommit(commit: ChapterCommit): Promise<{
    readonly added: number;
    readonly total: number;
    readonly conflicts: ReadonlyArray<TemporalConflict>;
  }> {
    const current = [...await this.load()];
    const nextFacts = factsFromCommit(commit);
    const eventIds = new Set(commit.events.map((event) => event.eventId));
    const withoutReplayed = current.filter((fact) => !eventIds.has(fact.sourceEventId));
    const combined = closeSupersededFacts([...withoutReplayed, ...nextFacts]);
    const conflicts = validateTemporalFacts(combined);
    const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
    if (blocking.length > 0) throw new Error(blocking.map((conflict) => conflict.message).join("; "));
    await writeJsonAtomic(this.path, combined);
    return { added: nextFacts.length, total: combined.length, conflicts };
  }

  async factsAt(subjectId: string, chapter: number): Promise<ReadonlyArray<TemporalFact>> {
    return (await this.load()).filter((fact) =>
      fact.subjectId === subjectId
      && fact.chapter <= chapter
      && (fact.validUntilChapter === undefined || fact.validUntilChapter >= chapter));
  }
}

export function factsFromCommit(commit: ChapterCommit): ReadonlyArray<TemporalFact> {
  const deltas = commit.stateDeltas.map((delta, index): TemporalFact => ({
    id: `temporal-${sha256(`${commit.commitId}\0${delta.subject}\0${delta.predicate}\0${canonicalJson(delta.newValue)}`).slice(0, 28)}`,
    subjectId: delta.subject,
    predicate: delta.predicate,
    value: delta.newValue,
    chapter: commit.chapter,
    order: index,
    sourceEventId: delta.sourceEventId ?? `${commit.commitId}:state:${index}`,
  }));
  const eventFacts = commit.events.flatMap((event, index): ReadonlyArray<TemporalFact> => {
    const predicate = eventPredicate(event.eventType);
    if (!predicate) return [];
    return [{
      id: `temporal-${sha256(`${event.eventId}\0${predicate}`).slice(0, 28)}`,
      subjectId: event.subject,
      predicate,
      value: event.object ?? event.payload.newValue ?? event.payload.location ?? event.payload.item ?? event.eventType,
      chapter: commit.chapter,
      order: deltas.length + index,
      sourceEventId: event.eventId,
    }];
  });
  return [...deltas, ...eventFacts];
}

export function validateTemporalFacts(facts: ReadonlyArray<TemporalFact>): ReadonlyArray<TemporalConflict> {
  const conflicts: TemporalConflict[] = [];
  const byMoment = new Map<string, TemporalFact[]>();
  for (const fact of facts) {
    const key = `${fact.subjectId}\0${fact.predicate}\0${fact.chapter}\0${fact.order}`;
    const group = byMoment.get(key) ?? [];
    group.push(fact);
    byMoment.set(key, group);
  }
  for (const group of byMoment.values()) {
    const values = unique(group.map((fact) => canonicalJson(fact.value)));
    if (values.length <= 1) continue;
    const fact = group[0]!;
    conflicts.push({
      code: "simultaneous-conflict",
      severity: corePredicate(fact.predicate) ? "blocking" : "warning",
      subjectId: fact.subjectId,
      message: `${fact.subjectId}.${fact.predicate} has conflicting values at chapter ${fact.chapter}`,
      factIds: group.map((item) => item.id),
    });
  }
  const deathBySubject = new Map<string, TemporalFact>();
  for (const fact of facts) {
    if (/(?:alive|生死|死亡|生命状态)/i.test(fact.predicate) && /(?:dead|死亡|已故)/i.test(String(fact.value))) {
      deathBySubject.set(fact.subjectId, fact);
    }
  }
  for (const fact of facts) {
    const death = deathBySubject.get(fact.subjectId);
    if (!death || fact.chapter <= death.chapter || fact.id === death.id) continue;
    if (/(?:location|位置|entered|exited|knowledge|item|关系)/i.test(fact.predicate)) {
      conflicts.push({
        code: "post-death-state-change",
        severity: "blocking",
        subjectId: fact.subjectId,
        message: `${fact.subjectId} changes ${fact.predicate} after death at chapter ${death.chapter}`,
        factIds: [death.id, fact.id],
      });
    }
  }
  return conflicts;
}

function closeSupersededFacts(facts: ReadonlyArray<TemporalFact>): ReadonlyArray<TemporalFact> {
  const sorted = [...facts].sort((left, right) =>
    left.chapter - right.chapter || left.order - right.order || left.id.localeCompare(right.id));
  const result: TemporalFact[] = [];
  const active = new Map<string, number>();
  for (const fact of sorted) {
    const key = `${fact.subjectId}\0${fact.predicate}`;
    const previousIndex = active.get(key);
    if (previousIndex !== undefined) {
      const previous = result[previousIndex]!;
      if (previous.chapter < fact.chapter) {
        result[previousIndex] = { ...previous, validUntilChapter: fact.chapter - 1 };
      }
    }
    active.set(key, result.length);
    result.push(fact);
  }
  return result;
}

function eventPredicate(eventType: string): string | null {
  if (eventType === "location_changed") return "location";
  if (eventType === "item_acquired" || eventType === "item_lost") return "item-ownership";
  if (eventType === "knowledge_gained" || eventType === "knowledge_corrected") return "knowledge";
  if (eventType === "relationship_changed" || eventType === "relationship_ended") return "relationship";
  if (eventType === "timeline_event") return "timeline";
  return null;
}

function corePredicate(predicate: string): boolean {
  return /location|位置|item|物品|alive|生死|死亡|identity|身份/i.test(predicate);
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

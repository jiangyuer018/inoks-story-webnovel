import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChapterCommit, StoryEvent } from "../story-system/types.js";
import type { CanonicalEvent, CanonicalStateChange, EntityRef } from "./types.js";

export interface CausalGraphValidation {
  readonly passed: boolean;
  readonly missingReferences: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
}

export interface RelevantHistoryQuery {
  readonly characterIds: ReadonlyArray<string>;
  readonly locationIds: ReadonlyArray<string>;
  readonly entityIds: ReadonlyArray<string>;
  readonly hookIds: ReadonlyArray<string>;
  readonly plannedEventIds: ReadonlyArray<string>;
  readonly semanticTerms?: ReadonlyArray<string>;
  readonly beforeChapter?: number;
  readonly maxEvents: number;
}

export class EventCausalGraphStore {
  readonly path: string;

  constructor(bookDir: string) {
    this.path = join(bookDir, "story", "state", "event-causal-graph.json");
  }

  async load(): Promise<ReadonlyArray<CanonicalEvent>> {
    const raw = await readFile(this.path, "utf-8").catch(() => "[]");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as CanonicalEvent[] : [];
  }

  async projectCommit(commit: ChapterCommit): Promise<{
    readonly added: number;
    readonly total: number;
    readonly validation: CausalGraphValidation;
  }> {
    const current = await this.load();
    const byId = new Map(current.map((event) => [event.id, event]));
    for (const event of commit.events) {
      byId.set(event.eventId, normalizeCanonicalEvent(commit, event));
    }
    const events = [...byId.values()].sort(compareEvents);
    const validation = validateEventCausalGraph(events);
    if (!validation.passed) {
      throw new Error([
        ...validation.missingReferences,
        ...validation.cycles.map((cycle) => `Causal cycle: ${cycle.join(" -> ")}`),
      ].join("; "));
    }
    await writeJsonAtomic(this.path, events);
    return { added: commit.events.length, total: events.length, validation };
  }

  async relevant(eventIds: ReadonlyArray<string>, limit?: number): Promise<ReadonlyArray<CanonicalEvent>>;
  async relevant(query: RelevantHistoryQuery): Promise<ReadonlyArray<CanonicalEvent>>;
  async relevant(
    queryOrEventIds: ReadonlyArray<string> | RelevantHistoryQuery,
    legacyLimit = 20,
  ): Promise<ReadonlyArray<CanonicalEvent>> {
    const events = await this.load();
    if (!Array.isArray(queryOrEventIds)) {
      return selectRelevantHistory(events, queryOrEventIds as RelevantHistoryQuery);
    }
    const byId = new Map(events.map((event) => [event.id, event]));
    const selected = new Map<string, CanonicalEvent>();
    const visit = (id: string): void => {
      if (selected.size >= legacyLimit || selected.has(id)) return;
      const event = byId.get(id);
      if (!event) return;
      selected.set(id, event);
      for (const dependency of [...event.causeEventIds, ...event.prerequisiteEventIds]) visit(dependency);
    };
    for (const id of queryOrEventIds as ReadonlyArray<string>) visit(id);
    return [...selected.values()];
  }
}

export function selectRelevantHistory(
  sourceEvents: ReadonlyArray<CanonicalEvent>,
  query: RelevantHistoryQuery,
): ReadonlyArray<CanonicalEvent> {
  const limit = Math.max(0, query.maxEvents);
  if (limit === 0) return [];
  const events = sourceEvents.filter((event) => (
    query.beforeChapter === undefined || event.time.chapter < query.beforeChapter
  ));
  const byId = new Map(events.map((event) => [event.id, event]));
  const planned = normalizedSet(query.plannedEventIds);
  const characters = normalizedSet(query.characterIds);
  const locations = normalizedSet(query.locationIds);
  const entities = normalizedSet(query.entityIds);
  const hooks = normalizedSet(query.hookIds);
  const semanticTerms = [...normalizedSet(query.semanticTerms ?? [])].filter((term) => term.length >= 2);
  const score = (event: CanonicalEvent): number => {
    let value = planned.has(normalizeTerm(event.id)) ? 1_000 : 0;
    const subject = normalizeTerm(event.subject.id || event.subject.name);
    const object = normalizeTerm(event.object?.id || event.object?.name || "");
    const location = normalizeTerm(event.location?.id || event.location?.name || "");
    if (characters.has(subject) || characters.has(object)) value += 120;
    if (entities.has(subject) || entities.has(object)) value += 90;
    if (locations.has(location)) value += 80;
    const searchable = normalizeTerm([
      event.id,
      event.subject.id,
      event.subject.name,
      event.object?.id,
      event.object?.name,
      event.location?.id,
      event.location?.name,
      event.predicate,
      event.actorGoal,
      ...event.enables,
      ...event.blocks,
    ].filter(Boolean).join(" "));
    for (const hook of hooks) if (searchable.includes(hook)) value += 70;
    for (const term of semanticTerms) if (searchable.includes(term)) value += 12;
    return value;
  };
  const ranked = events
    .map((event) => ({ event, score: score(event) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score
      || right.event.time.chapter - left.event.time.chapter
      || left.event.id.localeCompare(right.event.id));
  const selected = new Map<string, CanonicalEvent>();
  const visit = (id: string): void => {
    if (selected.size >= limit || selected.has(id)) return;
    const event = byId.get(id);
    if (!event) return;
    selected.set(id, event);
    for (const relatedId of [
      ...event.causeEventIds,
      ...event.prerequisiteEventIds,
      ...event.consequenceEventIds,
    ]) visit(relatedId);
  };
  for (const item of ranked) visit(item.event.id);
  return [...selected.values()].sort(compareEvents);
}

export function normalizeCanonicalEvent(commit: ChapterCommit, event: StoryEvent): CanonicalEvent {
  const causeEventIds = stringArray(event.payload.causeEventIds ?? event.payload.causes);
  const prerequisiteEventIds = stringArray(event.payload.prerequisiteEventIds ?? event.payload.prerequisites);
  const consequenceEventIds = stringArray(event.payload.consequenceEventIds ?? event.payload.consequences);
  const stateChanges: ReadonlyArray<CanonicalStateChange> = commit.stateDeltas
    .filter((delta) => delta.sourceEventId === event.eventId)
    .map((delta) => ({
      subject: entityRef(delta.subject),
      predicate: delta.predicate,
      oldValue: delta.oldValue,
      newValue: delta.newValue,
    }));
  return {
    id: event.eventId,
    commitId: commit.commitId,
    subject: entityRef(event.subject),
    predicate: String(event.payload.predicate ?? event.eventType),
    object: event.object ? entityRef(event.object) : undefined,
    actorGoal: typeof event.payload.actorGoal === "string" ? event.payload.actorGoal : undefined,
    causeEventIds,
    prerequisiteEventIds,
    consequenceEventIds,
    stateChanges,
    enables: stringArray(event.payload.enables),
    blocks: stringArray(event.payload.blocks),
    time: {
      chapter: event.chapter,
      order: typeof event.payload.order === "number" ? event.payload.order : event.sourceStart,
      label: typeof event.payload.time === "string" ? event.payload.time : undefined,
      startsAt: typeof event.payload.startsAt === "string" ? event.payload.startsAt : undefined,
      endsAt: typeof event.payload.endsAt === "string" ? event.payload.endsAt : undefined,
    },
    location: typeof event.payload.location === "string"
      ? entityRef(event.payload.location, "location")
      : undefined,
    certainty: event.epistemicStatus === "objective"
      ? "objective"
      : event.epistemicStatus === "rumor"
        ? "rumored"
        : event.epistemicStatus === "character-belief"
          ? "subjective"
          : "claimed",
    provenance: {
      sourceChapter: event.chapter,
      sourceCommitId: commit.commitId,
      sourceEventId: event.eventId,
      evidence: event.evidence.length > 0 ? event.evidence : [event.sourceExcerpt],
    },
  };
}

export function validateEventCausalGraph(events: ReadonlyArray<CanonicalEvent>): CausalGraphValidation {
  const ids = new Set(events.map((event) => event.id));
  const missingReferences = unique(events.flatMap((event) =>
    [...event.causeEventIds, ...event.prerequisiteEventIds, ...event.consequenceEventIds]
      .filter((id) => !ids.has(id))
      .map((id) => `${event.id} references missing event ${id}`)));
  const edges = new Map(events.map((event) => [
    event.id,
    [...event.causeEventIds, ...event.prerequisiteEventIds],
  ]));
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): void => {
    if (stack.has(id)) {
      const start = path.indexOf(id);
      cycles.push([...path.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.add(id);
    path.push(id);
    for (const dependency of edges.get(id) ?? []) {
      if (ids.has(dependency)) visit(dependency);
    }
    path.pop();
    stack.delete(id);
  };
  for (const event of events) visit(event.id);
  return { passed: missingReferences.length === 0 && cycles.length === 0, missingReferences, cycles };
}

function entityRef(value: string, type?: string): EntityRef {
  return { id: value, name: value, type };
}

function stringArray(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function compareEvents(left: CanonicalEvent, right: CanonicalEvent): number {
  return left.time.chapter - right.time.chapter
    || (left.time.order ?? 0) - (right.time.order ?? 0)
    || left.id.localeCompare(right.id);
}

function unique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function normalizedSet(values: ReadonlyArray<string>): Set<string> {
  return new Set(values.map(normalizeTerm).filter(Boolean));
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

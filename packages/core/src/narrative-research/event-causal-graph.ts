import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChapterCommit, StoryEvent } from "../story-system/types.js";
import type { CanonicalEvent, CanonicalStateChange, EntityRef } from "./types.js";

export interface CausalGraphValidation {
  readonly passed: boolean;
  readonly missingReferences: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<ReadonlyArray<string>>;
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

  async relevant(eventIds: ReadonlyArray<string>, limit = 20): Promise<ReadonlyArray<CanonicalEvent>> {
    const events = await this.load();
    const byId = new Map(events.map((event) => [event.id, event]));
    const selected = new Map<string, CanonicalEvent>();
    const visit = (id: string): void => {
      if (selected.size >= limit || selected.has(id)) return;
      const event = byId.get(id);
      if (!event) return;
      selected.set(id, event);
      for (const dependency of [...event.causeEventIds, ...event.prerequisiteEventIds]) visit(dependency);
    };
    for (const id of eventIds) visit(id);
    return [...selected.values()];
  }
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

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

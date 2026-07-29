import type { PlannedStoryEvent } from "./types.js";

export interface EventAllocationCandidate extends Omit<PlannedStoryEvent, "allocatedChapter" | "allocatedSceneIds"> {
  readonly earliestChapter: number;
  readonly latestChapter: number;
}

export function allocateEventsToChapters(params: {
  readonly events: ReadonlyArray<EventAllocationCandidate>;
  readonly startChapter: number;
  readonly maxEventsPerChapter: number;
}): ReadonlyArray<PlannedStoryEvent> {
  const byId = new Map(params.events.map((event) => [event.id, event]));
  const allocated = new Map<string, number>();
  const chapterLoads = new Map<number, number>();
  const visiting = new Set<string>();

  const place = (event: EventAllocationCandidate): number => {
    const existing = allocated.get(event.id);
    if (existing !== undefined) return existing;
    if (visiting.has(event.id)) throw new Error(`Event dependency cycle detected at ${event.id}`);
    visiting.add(event.id);
    const dependencyChapter = [...event.causes, ...event.prerequisites]
      .map((id) => byId.get(id))
      .filter((item): item is EventAllocationCandidate => Boolean(item))
      .reduce((latest, dependency) => Math.max(latest, place(dependency)), params.startChapter - 1);
    let chapter = Math.max(params.startChapter, event.earliestChapter, dependencyChapter + 1);
    while (
      chapter <= event.latestChapter
      && (chapterLoads.get(chapter) ?? 0) >= params.maxEventsPerChapter
    ) chapter += 1;
    if (chapter > event.latestChapter) {
      throw new Error(`No chapter capacity for event ${event.id} within ${event.earliestChapter}-${event.latestChapter}`);
    }
    visiting.delete(event.id);
    allocated.set(event.id, chapter);
    chapterLoads.set(chapter, (chapterLoads.get(chapter) ?? 0) + 1);
    return chapter;
  };

  return params.events.map((event) => {
    const allocatedChapter = place(event);
    return {
      id: event.id,
      type: event.type,
      actors: event.actors,
      targetEntities: event.targetEntities,
      causes: event.causes,
      prerequisites: event.prerequisites,
      expectedEffects: event.expectedEffects,
      allocatedChapter,
      allocatedSceneIds: [`chapter-${String(allocatedChapter).padStart(4, "0")}-scene-01`],
      importance: event.importance,
      concretenessTarget: event.concretenessTarget,
    };
  });
}

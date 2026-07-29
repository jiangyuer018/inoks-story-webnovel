import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChapterCommit } from "../story-system/types.js";
import type {
  CharacterGoalState,
  ConflictState,
  DecisionDebt,
  DynamicPlotState,
  PowerRelation,
  ResourceState,
  ThreatState,
} from "./types.js";

export const EMPTY_DYNAMIC_PLOT_STATE: DynamicPlotState = {
  currentGoals: [],
  activeConflicts: [],
  unresolvedDecisions: [],
  currentPowerRelations: [],
  availableResources: [],
  immediateThreats: [],
  activeReaderExpectations: [],
};

export class DynamicPlotStateStore {
  readonly path: string;

  constructor(bookDir: string) {
    this.path = join(bookDir, "story", "state", "dynamic-plot-state.json");
  }

  async load(): Promise<DynamicPlotState> {
    const raw = await readFile(this.path, "utf-8").catch(() => "");
    return raw ? JSON.parse(raw) as DynamicPlotState : EMPTY_DYNAMIC_PLOT_STATE;
  }

  async projectCommit(commit: ChapterCommit): Promise<DynamicPlotState> {
    const current = await this.load();
    const next = reduceDynamicPlotState(current, commit);
    await writeJsonAtomic(this.path, next);
    return next;
  }
}

export function reduceDynamicPlotState(state: DynamicPlotState, commit: ChapterCommit): DynamicPlotState {
  let goals = [...state.currentGoals];
  let conflicts = [...state.activeConflicts];
  let decisions = [...state.unresolvedDecisions];
  let power = [...state.currentPowerRelations];
  let resources = [...state.availableResources];
  let threats = [...state.immediateThreats];
  let expectations = [...state.activeReaderExpectations];

  for (const event of commit.events) {
    const payload = event.payload;
    if (typeof payload.goal === "string") {
      goals = upsert(goals, "characterId", {
        characterId: event.subject,
        goal: payload.goal,
        status: String(payload.goalStatus ?? "active") as CharacterGoalState["status"],
      });
    }
    if (typeof payload.conflictId === "string") {
      conflicts = upsert(conflicts, "id", {
        id: payload.conflictId,
        parties: arrayOfStrings(payload.parties ?? [event.subject, event.object].filter(Boolean)),
        stakes: String(payload.stakes ?? ""),
        pressure: numberInRange(payload.pressure, 0.5),
      } satisfies ConflictState);
    }
    if (typeof payload.decisionDebtId === "string") {
      decisions = upsert(decisions, "id", {
        id: payload.decisionDebtId,
        characterId: event.subject,
        decision: String(payload.decision ?? ""),
        dueChapter: typeof payload.dueChapter === "number" ? payload.dueChapter : undefined,
      } satisfies DecisionDebt);
    }
    if (event.eventType === "relationship_changed" && event.object) {
      power = upsertComposite(power, `${event.subject}\0${event.object}`, (item) => `${item.from}\0${item.to}`, {
        from: event.subject,
        to: event.object,
        advantage: String(payload.newValue ?? payload.relationship ?? ""),
        strength: numberInRange(payload.strength, 0.5),
      } satisfies PowerRelation);
    }
    if (event.eventType === "item_acquired") {
      const id = event.object ?? String(payload.itemId ?? payload.item ?? event.eventId);
      resources = upsert(resources, "id", { id, owner: event.subject, state: "available" } satisfies ResourceState);
    }
    if (event.eventType === "item_lost") {
      const id = event.object ?? String(payload.itemId ?? payload.item ?? "");
      resources = resources.filter((item) => item.id !== id);
    }
    if (typeof payload.threatId === "string") {
      threats = upsert(threats, "id", {
        id: payload.threatId,
        target: event.object ?? event.subject,
        description: String(payload.threat ?? ""),
        urgency: numberInRange(payload.urgency, 0.5),
      } satisfies ThreatState);
    }
    if (event.eventType === "reader_promise_created") expectations = unique([...expectations, event.subject]);
    if (event.eventType === "reader_promise_paid_off") expectations = expectations.filter((item) => item !== event.subject);
  }
  return {
    currentGoals: goals,
    activeConflicts: conflicts,
    unresolvedDecisions: decisions,
    currentPowerRelations: power,
    availableResources: resources,
    immediateThreats: threats,
    activeReaderExpectations: expectations,
  };
}

function upsert<T, K extends keyof T>(
  values: ReadonlyArray<T>,
  key: K,
  next: T,
): T[] {
  const filtered = values.filter((item) => item[key] !== next[key]);
  return [...filtered, next];
}

function upsertComposite<T>(
  values: ReadonlyArray<T>,
  key: string,
  select: (value: T) => string,
  next: T,
): T[] {
  return [...values.filter((item) => select(item) !== key), next];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberInRange(value: unknown, fallback: number): number {
  return typeof value === "number" ? Math.max(0, Math.min(1, value)) : fallback;
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

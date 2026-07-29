import type { ChapterSpec, SceneContract } from "../story-spec/types.js";
import type { PlaceholderDetectionResult } from "./types.js";

const PLACEHOLDER_PHRASES = [
  "维护自己的利益与立场",
  "承担失败或暴露的代价",
  "根据对方反应调整策略",
  "本章冲突来源",
  "产生可验证变化",
  "人物获得新的信息",
  "人物获得新信息或承受实际后果",
  "至少一项状态发生改变",
  "至少一项状态不能无成本复原",
  "至少一项可观察变化",
  "按当前大纲",
  "由剧情决定",
] as const;

export function detectStorySpecPlaceholders(spec: ChapterSpec): PlaceholderDetectionResult {
  const fields = collectFields(spec);
  const placeholders = new Set<string>();
  for (const value of fields) {
    for (const phrase of PLACEHOLDER_PHRASES) {
      if (value.includes(phrase)) placeholders.add(phrase);
    }
  }

  const missingFields = new Set<string>();
  requireText(missingFields, "pov", spec.pov);
  requireText(missingFields, "location", spec.location);
  requireText(missingFields, "time", spec.time);
  requireText(missingFields, "chapterGoal", spec.chapterGoal);
  if (spec.requiredStateChanges.length === 0) missingFields.add("requiredStateChanges");
  if (spec.sceneContracts.length === 0) missingFields.add("sceneContracts");

  spec.sceneContracts.forEach((scene, index) => {
    const base = `sceneContracts[${index}]`;
    requireText(missingFields, `${base}.pov`, scene.pov);
    requireText(missingFields, `${base}.immediateGoal`, scene.immediateGoal);
    requireText(missingFields, `${base}.oppositionGoal`, scene.oppositionGoal);
    requireText(missingFields, `${base}.conflictMethod`, scene.conflictMethod);
    requireText(missingFields, `${base}.turningPoint`, scene.turningPoint);
    requireText(missingFields, `${base}.decisionPoint`, scene.decisionPoint);
    requireText(missingFields, `${base}.irreversibleChange`, scene.irreversibleChange);
    if (Object.keys(scene.characterAgendas).length === 0) {
      missingFields.add(`${base}.characterAgendas`);
    }
    for (const [characterId, agenda] of Object.entries(scene.characterAgendas)) {
      const agendaBase = `${base}.characterAgendas.${characterId}`;
      requireText(missingFields, `${agendaBase}.wants`, agenda.wants);
      requireText(missingFields, `${agendaBase}.fears`, agenda.fears);
      requireText(missingFields, `${agendaBase}.tactic`, agenda.tactic);
      requireText(missingFields, `${agendaBase}.exitCondition`, agenda.exitCondition);
    }
    if (!stateChanged(scene)) missingFields.add(`${base}.entryExitStateChange`);
  });

  return {
    placeholders: [...placeholders],
    missingFields: [...missingFields],
    verdict: placeholders.size === 0 && missingFields.size === 0 ? "pass" : "block",
  };
}

function requireText(target: Set<string>, field: string, value: string): void {
  if (!value.trim()) target.add(field);
}

function stateChanged(scene: SceneContract): boolean {
  return JSON.stringify(scene.entryState) !== JSON.stringify(scene.exitState);
}

function collectFields(spec: ChapterSpec): ReadonlyArray<string> {
  const values: string[] = [
    spec.pov,
    spec.location,
    spec.time,
    spec.chapterGoal,
    ...spec.readerExpectation,
    ...spec.payoffTargets,
    ...spec.plannedEvents,
    ...spec.requiredStateChanges,
  ];
  for (const scene of spec.sceneContracts) {
    values.push(
      scene.pov,
      scene.immediateGoal,
      scene.oppositionGoal,
      scene.conflictMethod,
      scene.turningPoint,
      scene.decisionPoint,
      scene.irreversibleChange,
      ...scene.narrativeFunctions,
    );
    for (const agenda of Object.values(scene.characterAgendas)) {
      values.push(agenda.wants, agenda.fears, agenda.tactic, agenda.exitCondition);
    }
  }
  return values;
}

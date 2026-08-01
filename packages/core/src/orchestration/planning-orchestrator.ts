import { BenchmarkStore } from "../benchmark/index.js";
import type {
  AbstractNarrativeMechanism,
  NarrativeDeliveryProfile,
} from "../benchmark/types.js";
import {
  DynamicPlotStateStore,
  EventCausalGraphStore,
  createDefaultEmotionTrajectory,
  type CanonicalEvent,
  type DynamicPlotState,
  type EmotionTrajectory,
  type PsychologyState,
} from "../narrative-research/index.js";
import {
  PayoffLedgerStore,
  ReaderContractStore,
  type PayoffEntry,
  type ReaderContract,
} from "../story-craft/index.js";
import type { ChapterSpec } from "../story-spec/index.js";

export interface ChapterPlanningResearchContext {
  readonly dynamicPlotState: DynamicPlotState;
  readonly readerContract: ReaderContract;
  readonly payoffTargets: ReadonlyArray<PayoffEntry>;
  readonly benchmarkGuidance: ReadonlyArray<AbstractNarrativeMechanism>;
  readonly narrativeDeliveryProfiles: ReadonlyArray<NarrativeDeliveryProfile>;
  readonly relevantEventGraph: ReadonlyArray<CanonicalEvent>;
  readonly characterStates: ReadonlyArray<PsychologyState>;
  readonly emotionalTrajectory: EmotionTrajectory;
}

/**
 * Builds the bounded research context used to compile a chapter contract.
 * It deliberately queries the causal graph by current entities and goals; it
 * never falls back to the last N events or full-history prompt injection.
 */
export async function prepareChapterPlanningResearch(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly spec: ChapterSpec;
}): Promise<ChapterPlanningResearchContext> {
  const benchmarkStore = new BenchmarkStore(params.bookDir);
  const [dynamicPlotState, readerContract, payoffTargets, benchmarkGuidance, narrativeDeliveryProfiles] = await Promise.all([
    new DynamicPlotStateStore(params.bookDir).load(),
    new ReaderContractStore(params.bookDir).ensure(),
    new PayoffLedgerStore(params.bookDir).dueAt(params.chapterNumber),
    benchmarkStore.approvedMechanisms(),
    benchmarkStore.approvedDeliveryProfiles(),
  ]);
  const realizedScenes = params.spec.sceneRealization?.scenes ?? [];
  const characterIds = [...new Set([
    params.spec.pov,
    ...realizedScenes.flatMap((scene) => [scene.plan.povCharacterId, ...scene.plan.cast]),
    ...dynamicPlotState.currentGoals.map((goal) => goal.characterId),
  ].filter(Boolean))];
  const relevantEventGraph = await new EventCausalGraphStore(params.bookDir).relevant({
    characterIds,
    locationIds: [...new Set(realizedScenes.map((scene) => scene.plan.location).filter(Boolean))],
    entityIds: [...new Set([
      ...dynamicPlotState.availableResources.flatMap((resource) => [resource.id, resource.owner]),
      ...dynamicPlotState.immediateThreats.map((threat) => threat.target),
    ].filter(Boolean))],
    hookIds: [...new Set([
      ...params.spec.payoffTargets,
      ...params.spec.readerExpectation,
      ...dynamicPlotState.activeReaderExpectations,
    ].filter(Boolean))],
    plannedEventIds: [...new Set([
      ...params.spec.beats.map((beat) => beat.id),
      ...realizedScenes.flatMap((scene) => [scene.plan.id, ...scene.plan.beatIds]),
    ])],
    semanticTerms: [
      params.spec.chapterGoal,
      ...params.spec.plannedEvents,
      ...realizedScenes.flatMap((scene) => [
        scene.plan.immediateGoal,
        scene.plan.oppositionGoal,
        scene.plan.turningPoint,
        scene.plan.irreversibleChange,
      ]),
    ],
    beforeChapter: params.chapterNumber,
    maxEvents: 20,
  });
  const characterStates = realizedScenes.flatMap((scene) => scene.characterAgendas.map((agenda) => ({
    characterId: agenda.characterId,
    desire: agenda.wantsNow,
    fear: agenda.fearsNow,
    belief: Object.entries(agenda.beliefAboutOthers)
      .map(([id, belief]) => `${id}：${belief}`)
      .join("；") || agenda.tactic,
    selfImage: agenda.successCondition,
    relationshipBeliefs: agenda.beliefAboutOthers,
    emotionalPressure: [agenda.fearsNow, ...agenda.cannotSayDirectly],
    copingStrategy: agenda.tactic,
    contradiction: [agenda.wantsNow, ...agenda.hides].join("；"),
  }))) satisfies ReadonlyArray<PsychologyState>;
  return {
    dynamicPlotState,
    readerContract,
    payoffTargets,
    benchmarkGuidance,
    narrativeDeliveryProfiles,
    relevantEventGraph,
    characterStates,
    emotionalTrajectory: createDefaultEmotionTrajectory({
      id: params.spec.emotionalTrajectoryId,
      ownerCharacterId: params.spec.pov || undefined,
      goal: params.spec.chapterGoal,
      payoffTargets: params.spec.payoffTargets,
    }),
  };
}

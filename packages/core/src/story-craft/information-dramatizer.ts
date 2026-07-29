import type { InformationDeliveryPlan } from "../story-spec/types.js";

export function planInformationDelivery(params: {
  readonly fact: string;
  readonly readerNeedsNow: boolean;
  readonly characterKnowledgeState: string;
  readonly availableObjects?: ReadonlyArray<string>;
  readonly conflictPresent?: boolean;
  readonly observableConsequence?: string;
}): InformationDeliveryPlan {
  const possibleCarriers: InformationDeliveryPlan["possibleCarriers"] = [
    "action", "dialogue", "object", "reaction", "environment", "thought", "narration",
  ];
  const selectedCarriers = params.observableConsequence
    ? ["action", "reaction"]
    : (params.availableObjects?.length ?? 0) > 0
      ? ["object", "reaction"]
      : params.conflictPresent
        ? ["dialogue", "reaction"]
        : params.readerNeedsNow
          ? ["thought", "action"]
          : [];
  const narrationAllowed = params.readerNeedsNow && selectedCarriers.length === 0;
  return {
    fact: params.fact,
    readerNeedsNow: params.readerNeedsNow,
    characterKnowledgeState: params.characterKnowledgeState,
    possibleCarriers,
    selectedCarriers,
    dramaticMethod: selectedCarriers.length > 0
      ? `让信息通过${selectedCarriers.join(" + ")}改变人物当场选择`
      : "延迟到信息能影响选择的场景",
    narrationAllowed,
    narrationReason: narrationAllowed ? "读者必须立即理解时间、空间或因果，且当前没有可用场内载体。" : undefined,
  };
}

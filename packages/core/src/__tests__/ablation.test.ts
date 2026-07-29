import { describe, expect, it } from "vitest";
import {
  ABLATION_CONFIGURATIONS,
  buildAblationReport,
  type AblationRun,
} from "../evaluation/index.js";

function run(configuration: AblationRun["configuration"], withHuman = true): AblationRun {
  return {
    configuration,
    sampleId: "paired-sample",
    seed: "fixed-seed",
    model: "fixed-model",
    promptVersion: "v1",
    observations: {
      plotCompleteness: 80,
      causalCoherence: 82,
      emotionArcQuality: 75,
      expositionRatio: 0.22,
      actionDialogueCoupling: 78,
      beatFulfillment: 90,
      humanFeel: 76,
      continuityConflicts: 1,
      memoryConsistency: 88,
      postEditRatio: 0.12,
      similarityRisk: 0.08,
    },
    blindRatings: withHuman ? [{
      evaluatorId: "blind-editor-1",
      plotCompleteness: 4,
      causalCoherence: 4,
      emotionArcQuality: 3,
      naturalness: 4,
      readerRetention: 4,
      overall: 4,
    }] : [],
  };
}

describe("ablation evaluation", () => {
  it("only permits human interpretation for complete paired and blind-rated A-H runs", () => {
    const report = buildAblationReport(ABLATION_CONFIGURATIONS.map(({ id }) => run(id)), "2026-07-29T00:00:00.000Z");
    expect(report.diagnostics.pairedSampleIds).toEqual(["paired-sample"]);
    expect(report.diagnostics.incompleteSampleIds).toEqual([]);
    expect(report.interpretationStatus).toBe("eligible-for-human-interpretation");
    expect(report.configurations[0]?.metrics.expositionRatio).toMatchObject({
      mean: 0.22,
      direction: "lower-is-better",
      source: "automated",
    });
  });

  it("keeps incomplete or non-blind results in engineering-only status", () => {
    const report = buildAblationReport([run("A", false), run("B", false)]);
    expect(report.interpretationStatus).toBe("engineering-only");
    expect(report.diagnostics.incompleteSampleIds).toEqual(["paired-sample"]);
    expect(report.disclaimer).toContain("must not be presented");
  });
});

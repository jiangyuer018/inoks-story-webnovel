import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SceneEvaluationCaseSchema,
  buildSceneBlindEvaluationReport,
  type BlindSceneRating,
  type SceneEvaluationCase,
  type SceneEvaluationVariant,
  type SceneVariantArtifact,
} from "../evaluation/index.js";

const variants: ReadonlyArray<SceneEvaluationVariant> = [
  "baseline",
  "prompt-only",
  "realization-engine",
];

function fixtures(): {
  cases: SceneEvaluationCase[];
  artifacts: SceneVariantArtifact[];
  ratings: BlindSceneRating[];
} {
  const cases = Array.from({ length: 30 }, (_, index): SceneEvaluationCase => ({
    sampleId: `scene-${String(index + 1).padStart(3, "0")}`,
    title: `场景${index + 1}`,
    genre: "测试题材",
    chapterGoal: "人物必须通过选择改变现场状态",
    characters: [
      { id: "甲角色", wantsNow: "取得证据", hides: [], doesNotKnow: ["对方的真实计划"] },
      { id: "乙角色", wantsNow: "阻止证据外流", hides: ["知道证据位置"], doesNotKnow: [] },
    ],
    requiredInformation: ["证据藏在现场物件中"],
    entryState: ["甲角色没有证据"],
    exitState: ["乙角色的反应暴露证据"],
    mustKeep: [],
    forbiddenChanges: [],
  }));
  const artifacts = cases.flatMap((item) => variants.map((variant, index): SceneVariantArtifact => ({
    artifactId: `${item.sampleId}-${variant}`,
    sampleId: item.sampleId,
    variant,
    blindCode: ["X", "Y", "Z"][index]!,
    contentPath: `${variant}/${item.sampleId}.md`,
    contentHash: String(index + 1).repeat(64),
    model: "fixed-model",
    promptVersion: `${variant}-v1`,
    seed: `seed-${item.sampleId}`,
  })));
  const ratings = artifacts.map((artifact): BlindSceneRating => {
    const value = artifact.variant === "realization-engine" ? 5 : artifact.variant === "prompt-only" ? 4 : 3;
    return {
      artifactId: artifact.artifactId,
      evaluatorId: "blind-editor-1",
      humanLikeness: value,
      characterAgency: value,
      dialogueInterestAlignment: value,
      mutualInfluence: value,
      informationNaturalness: value,
      narrationNecessity: value,
      actionConsequence: value,
      psychologyStrategyChange: value,
      functionalEnvironment: value,
      readerContinuationIntent: value,
      notes: "",
    };
  });
  return { cases, artifacts, ratings };
}

describe("scene blind evaluation", () => {
  it("ships 30 unique, schema-valid fixed scene inputs", async () => {
    const source = JSON.parse(await readFile(
      resolve(process.cwd(), "../../evaluation/scene-inputs/cases.json"),
      "utf-8",
    )) as unknown;
    const cases = SceneEvaluationCaseSchema.array().parse(source);
    expect(cases).toHaveLength(30);
    expect(new Set(cases.map((item) => item.sampleId)).size).toBe(30);
  });

  it("requires 30 complete A/B/C cases and genuine blind ratings before interpretation", () => {
    const fixture = fixtures();
    const incomplete = buildSceneBlindEvaluationReport({
      cases: fixture.cases,
      artifacts: fixture.artifacts,
      ratings: [],
    });
    expect(incomplete.interpretationStatus).toBe("incomplete");
    expect(incomplete.humanConclusion).toBe("not-available");
    expect(incomplete.diagnostics.unratedArtifacts).toHaveLength(90);

    const complete = buildSceneBlindEvaluationReport({
      ...fixture,
      generatedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(complete.interpretationStatus).toBe("eligible-for-human-interpretation");
    expect(complete.humanConclusion).toBe("realization-engine-preferred");
    expect(complete.variants["realization-engine"].metrics.humanLikeness).toBe(5);
    expect(complete.variants.baseline.metrics.readerContinuationIntent).toBe(3);
  });

  it("rejects variant identity collisions and model/seed drift from interpretation", () => {
    const fixture = fixtures();
    const artifacts = fixture.artifacts.map((artifact, index) => ({
      ...artifact,
      ...(index === 0 ? { blindCode: "Y", model: "different-model" } : {}),
    }));
    const report = buildSceneBlindEvaluationReport({
      cases: fixture.cases,
      artifacts,
      ratings: fixture.ratings,
    });
    expect(report.interpretationStatus).toBe("incomplete");
    expect(report.diagnostics.blindCodeCollisions).toContain("scene-001");
    expect(report.diagnostics.modelOrPromptDrift).toContain("scene-001");
  });
});

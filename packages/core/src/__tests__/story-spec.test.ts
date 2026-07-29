import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReaderContractRequiredError,
  StorySpecPlaceholderError,
  StorySpecStore,
  compileWritingContract,
  ensureChapterSpec,
  ensureStoryConstitution,
  runStoryConvergence,
} from "../story-spec/index.js";
import { evaluateOutlineControl } from "../narrative-research/index.js";

const temporaryPaths: string[] = [];

async function temporaryBook(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inoks-story-spec-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Story Constitution and Fiction Spec", () => {
  it("creates the per-book constitution once without overwriting author edits", async () => {
    const bookDir = await temporaryBook();
    const initial = await ensureStoryConstitution(bookDir);
    const second = await ensureStoryConstitution(bookDir);
    expect(initial).toContain("场景优先");
    expect(second).toBe(initial);
    expect(await readFile(
      join(bookDir, ".inoks-story-webnovel", "story-spec", "constitution.md"),
      "utf-8",
    )).toBe(initial);
  });

  it("persists a versioned Chapter/Scene/Beat spec and compiles inherited constraints", async () => {
    const bookDir = await temporaryBook();
    const spec = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 1,
      intent: {
        chapter: 1,
        goal: "林舟拿到城门通行令",
        mustKeep: ["通行令必须由守门官亲手交给林舟"],
        mustAvoid: ["不能提前揭露内应身份"],
        styleEmphasis: ["对话带利益冲突"],
      },
      memo: {
        chapter: 1,
        goal: "取得通行令",
        isGoldenOpening: true,
        body: "## 章尾必须发生的改变\n- 林舟取得通行令\n\n## 读者此刻在等什么\n- 他如何越过封锁",
        threadRefs: [],
      },
      approvalMode: "automatic",
      blockOnPlaceholders: false,
    });
    const compiled = await compileWritingContract({
      bookDir,
      platform: "tomato",
      chapterSpec: spec,
    });
    expect(spec.status).toBe("approved");
    expect(spec.sceneContracts[0]?.narrativeFunctions.length).toBeGreaterThanOrEqual(2);
    expect(spec.beats.some((beat) => beat.function.includes("通行令"))).toBe(true);
    expect(compiled.platformProfile.id).toBe("fanqie");
    expect(compiled.constraints.hard.some((item) => item.id === "constitution.scene-first")).toBe(true);
    expect(compiled.forbiddenChanges).toContain("禁止：不能提前揭露内应身份");

    const versions = await new StorySpecStore(bookDir).listChapterVersions(1);
    expect(versions).toHaveLength(2);
  });

  it("keeps machine-generated specs awaiting review and blocks placeholder approval", async () => {
    const bookDir = await temporaryBook();
    const spec = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 4,
      intent: {
        chapter: 4,
        goal: "林舟逼守门官交出通行令",
        mustKeep: [],
        mustAvoid: [],
        styleEmphasis: [],
      },
    });
    expect(spec.status).toBe("awaiting-review");
    expect(spec.approvedAt).toBeUndefined();

    await expect(new StorySpecStore(bookDir).approveChapter(4, {
      expectedVersion: spec.version,
      approvedBy: "human",
    })).rejects.toBeInstanceOf(StorySpecPlaceholderError);
  });

  it("requires every Reader Contract promise section in formal writing mode", async () => {
    const bookDir = await temporaryBook();
    const spec = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 5,
      intent: {
        chapter: 5,
        goal: "林舟当众验证通行令",
        mustKeep: [],
        mustAvoid: [],
        styleEmphasis: [],
      },
      approvalMode: "automatic",
      blockOnPlaceholders: false,
    });
    await expect(compileWritingContract({
      bookDir,
      platform: "tomato",
      chapterSpec: spec,
      requireReaderContract: true,
    })).rejects.toBeInstanceOf(ReaderContractRequiredError);
  });

  it("does not advance past an unfulfilled hard beat", async () => {
    const bookDir = await temporaryBook();
    const spec = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 2,
      intent: {
        chapter: 2,
        goal: "取得通行令",
        mustKeep: ["守门官交出通行令"],
        mustAvoid: [],
        styleEmphasis: [],
      },
    });
    const hardBeat = {
      ...spec.beats.find((beat) => beat.function === "守门官交出通行令")!,
      strength: "hard" as const,
    };
    const missing = evaluateOutlineControl({
      content: "林舟在城门外与商贩交谈，随后折返客栈。",
      beats: [hardBeat],
    });
    expect(missing.verdict).toBe("block");
    expect(missing.missingBeatIds).toContain(hardBeat.id);

    const fulfilled = evaluateOutlineControl({
      content: "守门官反复核对印信，最后当面交出通行令。林舟接住令牌，城门随即开启。",
      beats: [hardBeat],
    });
    expect(fulfilled.fulfilledBeatIds).toContain(hardBeat.id);
  });

  it("records convergence and blocks before canonical settlement when a hard beat is missing", async () => {
    const bookDir = await temporaryBook();
    const spec = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 3,
      intent: {
        chapter: 3,
        goal: "取得证据",
        mustKeep: ["主角拿到带血账本"],
        mustAvoid: [],
        styleEmphasis: [],
      },
    });
    const hardBeat = {
      ...spec.beats.find((beat) => beat.function === "主角拿到带血账本")!,
      strength: "hard" as const,
    };
    const outlineControl = evaluateOutlineControl({
      content: "主角在屋内搜了一圈，空手离开。",
      beats: [hardBeat],
    });
    const result = await runStoryConvergence({
      bookDir,
      content: "主角在屋内搜了一圈，空手离开。",
      spec,
      outlineControl,
      gates: [
        { gate: "prose-quality", passed: true, blocking: true, details: [] },
        { gate: "continuity", passed: true, blocking: true, details: [] },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.blockingReasons.some((reason) => reason.includes("Missing beat"))).toBe(true);
  });
});

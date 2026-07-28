import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROSE_QUALITY_CONFIG,
  ProseQualityGateError,
  computeTextDiffStats,
  runProseQualityGate,
  scanProseQuality,
} from "../prose-quality/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prose quality scanner", () => {
  it.each([
    ["not-is-comparison", "他不是害怕，而是在计算门锁还能撑几秒。"],
    ["negative-positive-flip", "这并非退让，真正是一次诱敌。"],
    ["reverse-not-is", "是他的旧伤，不是胆怯让他停下。"],
    ["voice-contrast", "他的声音不大，却让门边三个人同时住了手。"],
    ["negation-parade", "没有风声，没有脚步，没有灯火，只是墙后传来一声咳嗽。"],
    ["em-dash", "他收起钥匙——换句话说，这意味着谈判结束了。"],
    ["trailer-ending", "她按下录音键。没人知道，真正的较量才刚刚开始。"],
  ])("detects narrow blocking rule %s", (ruleId, content) => {
    expect(scanProseQuality(content).issues.some((issue) => issue.ruleId === ruleId)).toBe(true);
  });

  it("does not block ordinary words, dialogue, or a functional dash", () => {
    const result = scanProseQuality([
      "“不是我。”她把钥匙推回桌面，“你去问值班员。”",
      "门闩断了——外面的人顺势撞进来，泥水溅到证物袋上。",
      "她忽然停住，听见楼道里有人换了口气。",
    ].join("\n\n"));
    expect(result.blockingCount).toBe(0);
  });

  it("reports advisory patterns only after their thresholds", () => {
    const longParagraph = "他拿起杯子，抬手推开门，转身走向窗边，低头看向桌面，伸手抓起账本。".repeat(7);
    const result = scanProseQuality(longParagraph);
    expect(result.issues.some((issue) => issue.ruleId === "long-paragraph")).toBe(true);
    expect(result.issues.some((issue) => issue.ruleId === "action-list-tic")).toBe(true);
    expect(result.blockingCount).toBe(0);
  });

  it("supports whitelist and stable source locations", () => {
    const content = "第一行。\n他的声音不大，却让门边的人停了手。";
    const plain = scanProseQuality(content);
    const issue = plain.issues.find((candidate) => candidate.ruleId === "voice-contrast");
    expect(issue).toMatchObject({ line: 2, column: 3 });
    expect(scanProseQuality(content, { whitelist: ["声音不大"] }).blockingCount).toBe(0);
    expect(scanProseQuality(content)).toEqual(plain);
  });

  it("merges optional project and book whitelist files without requiring either file", async () => {
    const projectRoot = await makeTemp();
    const bookDir = join(projectRoot, "books", "demo");
    await mkdir(join(projectRoot, ".inoks-story-webnovel"), { recursive: true });
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(
      join(projectRoot, ".inoks-story-webnovel", "prose-quality-whitelist.txt"),
      "# 项目术语\n声音不大\n",
      "utf-8",
    );
    await writeFile(
      join(bookDir, "story", "prose_quality_whitelist.txt"),
      "\n真正的较量 # 题材固定用语\n",
      "utf-8",
    );
    const result = await runProseQualityGate({
      content: "他的声音不大，却让门边的人停了手。没人知道，真正的较量才刚刚开始。",
      projectRoot,
      bookDir,
      chapterNumber: 1,
      title: "白名单",
      language: "zh",
      profile: "chapter",
      config: { ...DEFAULT_PROSE_QUALITY_CONFIG, autoRepair: false },
    });
    expect(result.scan.blockingCount).toBe(0);
  });

  it("keeps English on the legacy advisory-only branch", () => {
    const result = scanProseQuality("Maybe it seems possible. Perhaps it seemed likely.", { language: "en" });
    expect(result.blockingCount).toBe(0);
    expect(result.ruleVersion).toContain("en-legacy");
  });
});

describe("prose quality gate", () => {
  it("is idempotent for clean prose and does not call the naturalizer", async () => {
    const root = await makeTemp();
    const naturalize = vi.fn();
    const result = await runProseQualityGate({
      content: "雨水沿窗框滴到旧账本上。林岚用指腹抹开墨迹，露出昨天被遮住的日期。",
      projectRoot: root,
      bookDir: root,
      chapterNumber: 1,
      title: "旧账",
      language: "zh",
      profile: "chapter",
      config: DEFAULT_PROSE_QUALITY_CONFIG,
      naturalize,
    });
    expect(result.scan.blockingCount).toBe(0);
    expect(naturalize).not.toHaveBeenCalled();
  });

  it("repairs blocking prose and records token usage", async () => {
    const root = await makeTemp();
    const result = await runProseQualityGate({
      content: "他的声音不大，却让门边的人停了手。",
      projectRoot: root,
      bookDir: root,
      chapterNumber: 2,
      title: "停手",
      language: "zh",
      profile: "chapter",
      config: DEFAULT_PROSE_QUALITY_CONFIG,
      naturalize: async () => ({
        content: "他的声音压低，却让门边的人停了手。",
        tokenUsage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
      }),
    });
    expect(result.repaired).toBe(true);
    expect(result.scan.blockingCount).toBe(0);
    expect(result.tokenUsage.totalTokens).toBe(18);
  });

  it("rejects unresolved blocking prose in strict mode and saves the draft", async () => {
    const root = await makeTemp();
    await expect(runProseQualityGate({
      content: "他的声音不大，却让门边的人停了手。",
      projectRoot: root,
      bookDir: root,
      chapterNumber: 3,
      title: "拒绝",
      language: "zh",
      profile: "chapter",
      config: { ...DEFAULT_PROSE_QUALITY_CONFIG, autoRepair: false },
    })).rejects.toBeInstanceOf(ProseQualityGateError);
    expect(await readFile(join(root, ".inoks-story-webnovel", "rejected-drafts", "chapter-0003", "draft.md"), "utf-8"))
      .toContain("声音不大");
  });

  it("lets balanced mode warn and report-only mode scan without calling the model", async () => {
    const root = await makeTemp();
    const naturalize = vi.fn();
    const balanced = await runProseQualityGate({
      content: "他的声音不大，却让门边的人停了手。",
      projectRoot: root,
      bookDir: root,
      chapterNumber: 4,
      title: "告警",
      language: "zh",
      profile: "chapter",
      config: { ...DEFAULT_PROSE_QUALITY_CONFIG, enforcement: "balanced", autoRepair: false },
      naturalize,
    });
    expect(balanced.report.finalStatus).toBe("warning");
    const reportOnly = await runProseQualityGate({
      content: "他的声音不大，却让门边的人停了手。",
      projectRoot: root,
      bookDir: root,
      chapterNumber: 5,
      title: "报告",
      language: "zh",
      profile: "chapter",
      config: { ...DEFAULT_PROSE_QUALITY_CONFIG, enforcement: "report-only" },
      naturalize,
    });
    expect(reportOnly.report.finalStatus).toBe("warning");
    expect(naturalize).not.toHaveBeenCalled();
  });

  it("rolls back a continuity regression and preserves the original blocking draft", async () => {
    const root = await makeTemp();
    let auditCalls = 0;
    try {
      await runProseQualityGate({
        content: "他的声音不大，却让门边的人停了手。",
        projectRoot: root,
        bookDir: root,
        chapterNumber: 6,
        title: "回退",
        language: "zh",
        profile: "chapter",
        config: DEFAULT_PROSE_QUALITY_CONFIG,
        naturalize: async () => ({ content: "他的声音压低，却让门边的人停了手。" }),
        auditContinuity: async () => ({
          passed: auditCalls++ === 0,
          blockingCount: auditCalls === 1 ? 0 : 1,
        }),
      });
      throw new Error("expected the strict gate to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ProseQualityGateError);
      const gateError = error as ProseQualityGateError;
      expect(gateError.result.content).toContain("声音不大");
      expect(gateError.result.report.rolledBack).toBe(true);
      expect(gateError.result.report.iterations[0]?.reason).toBe("continuity-regressed");
    }
  });

  it("rejects an over-deleting repair and records the rollback reason", async () => {
    const root = await makeTemp();
    const original = [
      "他的声音不大，却让门边的人停了手。",
      "她的声音不高，却让走廊安静下来。",
      "雨水沿窗框滴到账本上，墨迹慢慢洇开。",
    ].join("\n");
    await expect(runProseQualityGate({
      content: original,
      projectRoot: root,
      bookDir: root,
      chapterNumber: 7,
      title: "删除保护",
      language: "zh",
      profile: "chapter",
      config: DEFAULT_PROSE_QUALITY_CONFIG,
      naturalize: async () => ({ content: "雨水沿窗框滴到账本上，墨迹慢慢洇开。" }),
    })).rejects.toSatisfy((error: unknown) => {
      const gateError = error as ProseQualityGateError;
      return gateError.result.content === original
        && gateError.result.report.iterations[0]?.reason === "deletion-ratio-exceeded";
    });
  });

  it("stops after two accepted repair attempts and accumulates usage", async () => {
    const root = await makeTemp();
    const naturalize = vi.fn(async ({ content }: { content: string }) => ({
      content: content.replace("他的声音不大，却", "他的声音压低，却"),
      tokenUsage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    }));
    const original = [
      "他的声音不大，却让甲停了手。",
      "他的声音不大，却让乙停了手。",
      "他的声音不大，却让丙停了手。",
    ].join("\n");
    try {
      await runProseQualityGate({
        content: original,
        projectRoot: root,
        bookDir: root,
        chapterNumber: 8,
        title: "两轮",
        language: "zh",
        profile: "chapter",
        config: DEFAULT_PROSE_QUALITY_CONFIG,
        naturalize,
      });
      throw new Error("expected unresolved blocking issues");
    } catch (error) {
      expect(error).toBeInstanceOf(ProseQualityGateError);
      const gateError = error as ProseQualityGateError;
      expect(naturalize).toHaveBeenCalledTimes(2);
      expect(gateError.result.report.iterations).toHaveLength(2);
      expect(gateError.result.tokenUsage).toEqual({ promptTokens: 4, completionTokens: 6, totalTokens: 10 });
    }
  });

  it("uses token diff rather than raw length and enforces deletion ratios", () => {
    const stats = computeTextDiffStats(
      "林岚拿起红色账本，记住一九九八年的编号。",
      "林岚拿起红色账本，记住一九九八年的编号。她关上门。",
    );
    expect(stats.insertedTokens).toBeGreaterThan(0);
    expect(stats.deletedTokens).toBe(0);
    expect(stats.modificationRatio).toBeGreaterThan(0);
  });
});

async function makeTemp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inoks-story-prose-quality-"));
  tempDirs.push(path);
  return path;
}

import { describe, expect, it } from "vitest";
import {
  deriveWorkbenchOverviewState,
  formatStoryMigrationWarning,
  formatStorySystemIssue,
} from "./story-workbench-state";

function derive(overrides: Partial<Parameters<typeof deriveWorkbenchOverviewState>[0]> = {}) {
  return deriveWorkbenchOverviewState({
    pendingOutlineCount: 0,
    storyHeadChapter: null,
    storyPreflightPassed: true,
    storyPreflightErrors: [],
    rejectedCommitCount: 0,
    proseReports: [],
    humanReports: [],
    ...overrides,
  });
}

describe("deriveWorkbenchOverviewState", () => {
  it("sends a new book to first-chapter generation instead of a missing quality report", () => {
    const state = derive();

    expect(state.qualityState).toBe("waiting");
    expect(state.nextAction).toMatchObject({
      title: "生成并审查第一章",
      buttonLabel: "开始生成第一章",
      destination: "book",
      requiresAttention: false,
    });
  });

  it("uses the newest-first report rather than an older passing report", () => {
    const state = derive({
      storyHeadChapter: 3,
      proseReports: [
        { blockingCount: 1, finalStatus: "rejected" },
        { blockingCount: 0, finalStatus: "accepted" },
      ],
      humanReports: [
        { verdict: "pass" },
        { verdict: "pass" },
      ],
    });

    expect(state.qualityState).toBe("attention");
    expect(state.nextAction.destination).toBe("quality");
    expect(state.nextAction.title).toBe("处理正文质量阻断");
  });

  it("does not let an older blocked report override the newest clean result", () => {
    const state = derive({
      storyHeadChapter: 3,
      proseReports: [
        { blockingCount: 0, finalStatus: "accepted" },
        { blockingCount: 2, finalStatus: "rejected" },
      ],
      humanReports: [
        { verdict: "pass" },
        { verdict: "block" },
      ],
    });

    expect(state.qualityState).toBe("done");
    expect(state.nextAction).toMatchObject({
      title: "生成第 4 章",
      destination: "book",
    });
  });

  it("routes incomplete quality output to the report instead of treating it as a clean commit", () => {
    const state = derive({
      proseReports: [{ blockingCount: 0, finalStatus: "accepted" }],
    });

    expect(state.qualityState).toBe("attention");
    expect(state.nextAction).toMatchObject({
      title: "检查未完成的质量审查",
      destination: "quality",
    });
  });

  it("prioritizes pending outline decisions before generation", () => {
    const state = derive({
      pendingOutlineCount: 2,
      storyHeadChapter: 8,
      proseReports: [{ blockingCount: 0, finalStatus: "accepted" }],
      humanReports: [{ verdict: "pass" }],
    });

    expect(state.nextAction).toMatchObject({
      title: "处理动态大纲提案",
      destination: "outline",
      requiresAttention: true,
    });
  });

  it("requires the Reader Contract before first-chapter generation", () => {
    const state = derive({ readerContractReady: false });
    expect(state.nextAction).toMatchObject({
      title: "完成 Reader Contract",
      destination: "spec",
      requiresAttention: true,
    });
  });

  it("shows human approval instead of sending a reviewed draft back to quality reports", () => {
    const state = derive({
      readerContractReady: true,
      proseReports: [{ chapter: 1, blockingCount: 0, finalStatus: "accepted" }],
      humanReports: [{ chapter: 1, verdict: "pass" }],
      pendingChapterApprovals: [{ chapter: 1, status: "awaiting-human-approval" }],
    });
    expect(state.nextAction).toMatchObject({
      title: "批准第 1 章正文",
      destination: "book",
      requiresAttention: true,
    });
  });

  it("does not treat a committed chapter's older report as a current blocker", () => {
    const state = derive({
      readerContractReady: true,
      storyHeadChapter: 4,
      proseReports: [{ chapter: 4, blockingCount: 2, finalStatus: "rejected" }],
      humanReports: [{ chapter: 4, verdict: "block" }],
    });
    expect(state.nextAction).toMatchObject({ title: "生成第 5 章", destination: "book" });
  });

  it("routes legacy chapters without commits to migration before every other action", () => {
    const state = derive({
      pendingOutlineCount: 2,
      storyPreflightPassed: false,
      storyPreflightErrors: [
        "legacy-history-unmigrated: existing chapters have no accepted ChapterCommit",
      ],
    });

    expect(state.nextAction).toMatchObject({
      title: "迁移现有章节历史",
      destination: "system",
      requiresAttention: true,
    });
  });

  it("routes a committed book with failed preflight to projection repair", () => {
    const state = derive({
      storyHeadChapter: 1,
      storyPreflightPassed: false,
      proseReports: [{ blockingCount: 0, finalStatus: "accepted" }],
      humanReports: [{ verdict: "pass" }],
    });

    expect(state.nextAction).toMatchObject({
      title: "修复正史或投影异常",
      destination: "system",
    });
  });
});

describe("formatStorySystemIssue", () => {
  it("turns the legacy migration machine code into an actionable Studio message", () => {
    expect(formatStorySystemIssue(
      "legacy-history-unmigrated: existing chapters have no accepted ChapterCommit",
    )).toBe("检测到尚未迁移的旧章节。请先生成迁移预览并建立 ChapterCommit 正史链。");
  });

  it("preserves unknown diagnostics for forward compatibility", () => {
    expect(formatStorySystemIssue("future-check: details")).toBe("future-check: details");
  });
});

describe("formatStoryMigrationWarning", () => {
  it("renders dry-run guidance in Chinese without changing stored report data", () => {
    expect(formatStoryMigrationWarning(
      "Dry-run candidates do not switch authority. Re-run with --apply after reviewing the report.",
    )).toBe("迁移预览不会切换正史权限。确认报告后，再点击下方按钮应用迁移。");
  });

  it("preserves future migration warnings", () => {
    expect(formatStoryMigrationWarning("future migration warning")).toBe("future migration warning");
  });
});

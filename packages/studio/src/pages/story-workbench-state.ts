export type WorkbenchDestination = "book" | "spec" | "outline" | "quality" | "canon" | "system";

export interface WorkbenchReportSummary {
  readonly chapter?: number;
  readonly score?: number;
  readonly blockingCount?: number;
  readonly finalStatus?: string;
  readonly verdict?: string;
  readonly level?: string;
}

export interface WorkbenchNextAction {
  readonly title: string;
  readonly description: string;
  readonly buttonLabel: string;
  readonly destination: WorkbenchDestination;
  readonly requiresAttention: boolean;
}

export interface WorkbenchOverviewState {
  readonly nextAction: WorkbenchNextAction;
  readonly latestProse?: WorkbenchReportSummary;
  readonly latestHuman?: WorkbenchReportSummary;
  readonly qualityState: "done" | "attention" | "waiting";
}

export function formatStorySystemIssue(issue: string): string {
  if (issue.startsWith("legacy-history-unmigrated:")) {
    return "检测到尚未迁移的旧章节。请先生成迁移预览并建立 ChapterCommit 正史链。";
  }
  if (issue.startsWith("history-diverged:")) {
    return `章节历史与 accepted Commit 不一致。请通过修订 Commit 处理，详情：${issue.slice("history-diverged:".length).trim()}`;
  }
  if (issue.startsWith("projection-drift:")) {
    return `派生状态与 accepted Commit 不一致，需要重新投影。详情：${issue.slice("projection-drift:".length).trim()}`;
  }
  if (issue.startsWith("Projection pending:")) {
    return `必需投影尚未完成：${issue.slice("Projection pending:".length).trim()}`;
  }
  if (issue.startsWith("MemoryDB projection is behind HEAD")) {
    return `长期记忆投影落后于当前正史：${issue.slice("MemoryDB projection is behind ".length).trim()}`;
  }
  return issue;
}

export function formatStoryMigrationWarning(warning: string): string {
  if (warning.startsWith("Legacy history has no per-chapter event provenance")) {
    return "旧章节没有逐章事件来源记录；现有事实与伏笔会在最后一条旧历史 Commit 中完成引导建立。";
  }
  if (warning.startsWith("Dry-run candidates do not switch authority")) {
    return "迁移预览不会切换正史权限。确认报告后，再点击下方按钮应用迁移。";
  }
  return warning;
}

export function deriveWorkbenchOverviewState(input: {
  readonly pendingOutlineCount: number;
  readonly storyHeadChapter: number | null;
  readonly storyPreflightPassed: boolean;
  readonly storyPreflightErrors: ReadonlyArray<string>;
  readonly rejectedCommitCount: number;
  /**
   * Workbench quality endpoints return newest-first arrays.
   */
  readonly proseReports: ReadonlyArray<WorkbenchReportSummary>;
  readonly humanReports: ReadonlyArray<WorkbenchReportSummary>;
  readonly readerContractReady?: boolean;
  readonly pendingSpecCount?: number;
  readonly pendingChapterApprovals?: ReadonlyArray<{ readonly chapter: number; readonly status: string }>;
}): WorkbenchOverviewState {
  const latestProse = input.proseReports[0];
  const latestHuman = input.humanReports[0];
  const hasAnyQualityReport = Boolean(latestProse || latestHuman);
  const hasCompleteQualityReport = Boolean(latestProse && latestHuman);
  const proseBlocked = Boolean(
    latestProse
    && ((latestProse.blockingCount ?? 0) > 0
      || /reject|failed|blocked/i.test(latestProse.finalStatus ?? "")),
  );
  const humanBlocked = Boolean(
    latestHuman
    && /block|revise|reject|failed/i.test(latestHuman.verdict ?? latestHuman.level ?? ""),
  );
  const qualityBlocked = proseBlocked || humanBlocked;
  const qualityIncomplete = hasAnyQualityReport && !hasCompleteQualityReport;
  const latestQualityChapter = Math.max(latestProse?.chapter ?? 0, latestHuman?.chapter ?? 0);
  const qualityRequiresAction = latestQualityChapter === 0
    ? hasAnyQualityReport
    : latestQualityChapter > (input.storyHeadChapter ?? 0);
  const legacyHistoryNeedsMigration = input.storyPreflightErrors.some((error) =>
    error.startsWith("legacy-history-unmigrated:"));
  const qualityState = !hasAnyQualityReport
    ? "waiting"
    : qualityBlocked || qualityIncomplete
      ? "attention"
      : "done";

  let nextAction: WorkbenchNextAction;
  if (legacyHistoryNeedsMigration) {
    nextAction = {
      title: "迁移现有章节历史",
      description: "检测到旧格式章节，但尚未建立 ChapterCommit 链。请先预览迁移并创建备份。",
      buttonLabel: "打开迁移工具",
      destination: "system",
      requiresAttention: true,
    };
  } else if (input.readerContractReady === false) {
    nextAction = {
      title: "完成 Reader Contract",
      description: "正式写作要求核心幻想、情绪、成长、关系、谜团、身份与禁止背叛事项全部明确。",
      buttonLabel: "填写读者合同",
      destination: "spec",
      requiresAttention: true,
    };
  } else if ((input.pendingSpecCount ?? 0) > 0) {
    nextAction = {
      title: "审阅具体场景规格",
      description: `${input.pendingSpecCount} 个 Chapter Spec 等待人工批准；请核对人物议程、互动链与旁白许可。`,
      buttonLabel: "查看并批准规格",
      destination: "spec",
      requiresAttention: true,
    };
  } else if (input.pendingOutlineCount > 0) {
    nextAction = {
      title: "处理动态大纲提案",
      description: `${input.pendingOutlineCount} 项提案正在等待批准或拒绝，处理后才能继续自动写作。`,
      buttonLabel: "查看大纲提案",
      destination: "outline",
      requiresAttention: true,
    };
  } else if ((input.pendingChapterApprovals?.length ?? 0) > 0) {
    const pending = input.pendingChapterApprovals![0]!;
    nextAction = {
      title: pending.status === "human-editing" ? `重新审查第 ${pending.chapter} 章修改` : `批准第 ${pending.chapter} 章正文`,
      description: pending.status === "human-editing"
        ? "正文在审查后被修改，旧批准已失效；请重新运行审查后再批准。"
        : "自动质量门已经完成，accepted ChapterCommit 正等待作者核对并批准当前正文哈希。",
      buttonLabel: "打开待批准正文",
      destination: "book",
      requiresAttention: true,
    };
  } else if (qualityRequiresAction && (qualityBlocked || qualityIncomplete)) {
    nextAction = {
      title: qualityBlocked ? "处理正文质量阻断" : "检查未完成的质量审查",
      description: qualityBlocked
        ? "最新正文仍有阻断项，正式章节和正史状态不会在问题解决前更新。"
        : "本次写章只生成了部分审查结果，请查看报告和失败原因后再继续。",
      buttonLabel: "查看质量报告",
      destination: "quality",
      requiresAttention: true,
    };
  } else if (input.storyHeadChapter === null) {
    if (hasCompleteQualityReport || input.rejectedCommitCount > 0) {
      nextAction = {
        title: "核对第一章提交条件",
        description: "质量审查已有结果，但尚未形成 accepted Commit，请查看连续性、消歧或提交阻断。",
        buttonLabel: "查看提交状态",
        destination: "canon",
        requiresAttention: true,
      };
    } else {
      nextAction = {
        title: "生成并审查第一章",
        description: "返回作品页开始写作。正文会依次经过长度治理、质量门、连续性审查和 ChapterCommit。",
        buttonLabel: "开始生成第一章",
        destination: "book",
        requiresAttention: false,
      };
    }
  } else if (!input.storyPreflightPassed) {
    nextAction = {
      title: "修复正史或投影异常",
      description: "下一章已暂停。先修复 Commit 链、章节哈希或必需投影，再恢复写作。",
      buttonLabel: "打开系统修复",
      destination: "system",
      requiresAttention: true,
    };
  } else {
    nextAction = {
      title: `生成第 ${input.storyHeadChapter + 1} 章`,
      description: "当前正史和派生投影一致，可以返回作品页继续规划或直接生成下一章。",
      buttonLabel: "继续写下一章",
      destination: "book",
      requiresAttention: false,
    };
  }

  return {
    nextAction,
    latestProse,
    latestHuman,
    qualityState,
  };
}

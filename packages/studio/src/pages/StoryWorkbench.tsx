import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Check,
  Download,
  GitBranch,
  Loader2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { postApi, putApi, useApi } from "../hooks/use-api";
import { Button } from "../components/ui/button";
import {
  deriveWorkbenchOverviewState,
  formatStoryMigrationWarning,
  formatStorySystemIssue,
} from "./story-workbench-state";

type Tab = "overview" | "spec" | "outline" | "benchmark" | "quality" | "canon" | "system" | "automation" | "publishing";

interface StoryWorkbenchData {
  readonly bookId: string;
  readonly constitution: string;
  readonly specs: ReadonlyArray<{
    readonly id: string;
    readonly version: number;
    readonly status: string;
    readonly chapterNumber: number;
    readonly chapterGoal: string;
    readonly hardConstraints: ReadonlyArray<string>;
    readonly requiredBeats: ReadonlyArray<string>;
    readonly planningValidation: {
      readonly placeholders: ReadonlyArray<string>;
      readonly missingFields: ReadonlyArray<string>;
      readonly verdict: "pass" | "block";
    };
    readonly sceneRealization?: {
      readonly schemaVersion: string;
      readonly scenes: ReadonlyArray<{
        readonly plan: {
          readonly id: string;
          readonly order: number;
          readonly location: string;
          readonly time: string;
          readonly immediateGoal: string;
          readonly oppositionGoal: string;
          readonly stakes: string;
          readonly turningPoint: string;
          readonly decisionPoint: string;
          readonly irreversibleChange: string;
          readonly status: string;
        };
        readonly characterAgendas: ReadonlyArray<{
          readonly characterId: string;
          readonly wantsNow: string;
          readonly fearsNow: string;
          readonly hides: ReadonlyArray<string>;
          readonly cannotSayDirectly: ReadonlyArray<string>;
          readonly tactic: string;
        }>;
        readonly informationUnits: ReadonlyArray<{
          readonly id: string;
          readonly fact: string;
          readonly selectedCarriers: ReadonlyArray<string>;
          readonly deliveryMethod: string;
          readonly consequence: string;
          readonly narrationAllowed: boolean;
        }>;
        readonly interactionTurns: ReadonlyArray<{
          readonly order: number;
          readonly initiator: string;
          readonly responder: string;
          readonly stimulus: string;
          readonly strategyAfter: string;
          readonly outwardActionOrDialogue: string;
          readonly effectOnOtherCharacter: string;
        }>;
        readonly narrationPermissions: ReadonlyArray<{
          readonly informationUnitId: string;
          readonly reason: string;
          readonly maximumChars: number;
          readonly requiredContent: string;
        }>;
      }>;
    };
  }>;
  readonly readerContract: {
    readonly coreFantasy: ReadonlyArray<string>;
    readonly emotionalPromises: ReadonlyArray<string>;
    readonly progressionPromises: ReadonlyArray<string>;
    readonly relationshipPromises: ReadonlyArray<string>;
    readonly mysteryPromises: ReadonlyArray<string>;
    readonly identityPromises: ReadonlyArray<string>;
    readonly forbiddenBetrayals: ReadonlyArray<string>;
    readonly version: number;
    readonly updatedAt: string;
    readonly missingSections: ReadonlyArray<ReaderContractField>;
    readonly ready: boolean;
  };
  readonly pendingApprovals: ReadonlyArray<{
    readonly chapter: number;
    readonly title: string;
    readonly status: string;
    readonly contentHash: string;
    readonly reviewedContentHash: string;
    readonly proseQuality: {
      readonly score: number;
      readonly level: string;
      readonly blockingCount: number;
      readonly advisoryCount: number;
      readonly repaired: boolean;
    } | null;
  }>;
  readonly outlineRevisions: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly reasons: ReadonlyArray<string>;
    readonly affectedSpecIds: ReadonlyArray<string>;
    readonly proposedChanges: ReadonlyArray<{
      readonly specId: string;
      readonly field: string;
      readonly newValue: unknown;
    }>;
  }>;
  readonly benchmarkProfiles: ReadonlyArray<{
    readonly sourceId: string;
    readonly title: string;
    readonly roles: ReadonlyArray<string>;
    readonly extractedMechanisms: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly emotionalFunction: string;
      readonly approved: boolean;
      readonly prohibitedSourceDetails: ReadonlyArray<string>;
    }>;
  }>;
  readonly payoffLedger: ReadonlyArray<{
    readonly id: string;
    readonly promise: string;
    readonly status: string;
    readonly targetWindow: { readonly from: number; readonly to: number };
  }>;
  readonly publications: ReadonlyArray<{
    readonly chapterNumber: number;
    readonly chapterCommitId: string;
    readonly platform: string;
    readonly status: string;
    readonly exportedFileName?: string;
  }>;
  readonly automation: {
    readonly config: {
      readonly enabled: boolean;
      readonly priority: number;
      readonly chaptersPerCycle: number;
      readonly maxChaptersPerDay: number;
      readonly minIntervalMinutes: number;
      readonly runOnDaemonStart: boolean;
      readonly requireHumanApprovalBeforeCommit: boolean;
      readonly requireHumanApprovalBeforePublish: boolean;
    };
    readonly runtime: {
      readonly paused: boolean;
      readonly editing: boolean;
      readonly pauseReason?: string;
      readonly lastWrittenAt?: string;
      readonly dailyCount: number;
      readonly lastError?: string;
    };
  };
  readonly storyHead: { readonly commitId: string; readonly chapter: number; readonly hash: string } | null;
  readonly storyPreflight: {
    readonly passed: boolean;
    readonly headCommitId: string | null;
    readonly headChapter: number;
    readonly repairedTransactions: ReadonlyArray<string>;
    readonly errors: ReadonlyArray<string>;
    readonly warnings: ReadonlyArray<string>;
  };
  readonly storySystem: {
    readonly acceptedCommitCount: number;
    readonly rejectedCommitCount: number;
    readonly projectionFailures: ReadonlyArray<string>;
    readonly latestMigration: StoryMigrationReport | null;
    readonly automaticPublicationEnabled: false;
  };
  readonly quality: {
    readonly prose: ReadonlyArray<QualityReport>;
    readonly "scene-semantic": ReadonlyArray<SceneSemanticReport>;
    readonly "human-feel": ReadonlyArray<HumanFeelReport>;
    readonly payoff: ReadonlyArray<QualityReport>;
  };
}

interface QualityReport {
  readonly reportPath: string;
  readonly chapter?: number;
  readonly score?: number;
  readonly level?: string;
  readonly finalStatus?: string;
  readonly blockingCount?: number;
  readonly advisoryCount?: number;
  readonly verdict?: string;
  readonly issues?: ReadonlyArray<{ readonly id?: string; readonly message?: string; readonly severity?: string }>;
}

interface HumanFeelIssue {
  readonly id: string;
  readonly category: string;
  readonly severity: string;
  readonly message: string;
  readonly rationale: string;
  readonly suggestion: string;
  readonly paragraphIndex: number;
  readonly excerpt: string;
}

interface HumanFeelReport extends QualityReport {
  readonly blockingIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly expositionIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly decorativeEnvironmentIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly genericMetaphorIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly emptyActionIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly redundantThoughtIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly artificialDialogueIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly reactionCouplingIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly sceneStagnationIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly overNeatPlotIssues?: ReadonlyArray<HumanFeelIssue>;
  readonly excessiveExplanationIssues?: ReadonlyArray<HumanFeelIssue>;
}

const TABS: ReadonlyArray<{ readonly id: Tab; readonly zh: string; readonly en: string }> = [
  { id: "overview", zh: "总览", en: "Overview" },
  { id: "spec", zh: "规格", en: "Specs" },
  { id: "outline", zh: "动态大纲", en: "Outline" },
  { id: "benchmark", zh: "对标机制", en: "Benchmark" },
  { id: "quality", zh: "质量审查", en: "Quality" },
  { id: "canon", zh: "正史提交", en: "Canon" },
  { id: "system", zh: "系统与投影", en: "System" },
  { id: "automation", zh: "自动化", en: "Automation" },
  { id: "publishing", zh: "发布", en: "Publishing" },
];

export function StoryWorkbench({
  bookId,
  nav,
}: {
  readonly bookId: string;
  readonly nav: { readonly toBook: (bookId: string) => void };
}) {
  const path = `/books/${encodeURIComponent(bookId)}/story-workbench`;
  const { data, loading, error, refetch } = useApi<StoryWorkbenchData>(path);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      await refetch();
      setNotice(message);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <WorkbenchSkeleton />;
  if (error || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <h1 className="text-xl font-semibold">故事工作台加载失败</h1>
        <p className="mt-2 text-sm text-destructive">{error ?? "No data"}</p>
        <Button className="mt-4" variant="outline" onClick={() => void refetch()}>重新加载</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" onClick={() => nav.toBook(bookId)} className="text-sm text-muted-foreground hover:text-foreground">
            返回作品
          </button>
          <h1 className="mt-2 text-3xl">故事控制中心</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            从章纲到发布交付，每一步都显示来源、阻断项和下一项人工动作。
          </p>
        </div>
        <HeadStatus data={data} />
      </header>

      <nav aria-label="Story workbench sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={`shrink-0 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === item.id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.zh}
          </button>
        ))}
      </nav>

      {notice && (
        <div role="status" className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      {tab === "overview" && (
        <OverviewPanel
          data={data}
          busy={busy}
          act={act}
          setTab={setTab}
          toBook={() => nav.toBook(bookId)}
        />
      )}
      {tab === "spec" && <SpecPanel data={data} busy={busy} act={act} path={path} />}
      {tab === "outline" && <OutlinePanel data={data} busy={busy} act={act} path={path} />}
      {tab === "benchmark" && <BenchmarkPanel data={data} busy={busy} act={act} path={path} />}
      {tab === "quality" && <QualityPanel data={data} busy={busy} act={act} path={path} />}
      {tab === "canon" && <CanonPanel data={data} busy={busy} act={act} path={path} />}
      {tab === "system" && <SystemPanel data={data} path={path} busy={busy} act={act} bookId={bookId} />}
      {tab === "automation" && <AutomationPanel data={data} busy={busy} act={act} path={path} />}
      {tab === "publishing" && <PublishingPanel data={data} busy={busy} act={act} path={path} />}
    </div>
  );
}

function HeadStatus({ data }: { readonly data: StoryWorkbenchData }) {
  return (
    <div className="min-w-[260px] rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck size={16} className={data.storyHead ? "text-emerald-600" : "text-amber-600"} />
        {data.storyHead ? `正史已提交至第 ${data.storyHead.chapter} 章` : "尚无 accepted Commit"}
      </div>
      {data.storyHead && (
        <code className="mt-2 block truncate text-xs text-muted-foreground" title={data.storyHead.commitId}>
          {data.storyHead.commitId}
        </code>
      )}
    </div>
  );
}

function OverviewPanel({
  data,
  busy,
  act,
  setTab,
  toBook,
}: {
  readonly data: StoryWorkbenchData;
  readonly busy: string | null;
  readonly act: PanelProps["act"];
  readonly setTab: (tab: Tab) => void;
  readonly toBook: () => void;
}) {
  const pendingOutline = data.outlineRevisions.filter((revision) => revision.status === "proposed").length;
  const publication = data.publications.at(-1);
  const overview = deriveWorkbenchOverviewState({
    pendingOutlineCount: pendingOutline,
    storyHeadChapter: data.storyHead?.chapter ?? null,
    storyPreflightPassed: data.storyPreflight.passed,
    storyPreflightErrors: data.storyPreflight.errors,
    rejectedCommitCount: data.storySystem.rejectedCommitCount,
    proseReports: data.quality.prose,
    humanReports: data.quality["human-feel"],
    readerContractReady: data.readerContract.ready,
    pendingSpecCount: data.specs.filter((spec) => spec.status === "awaiting-review").length,
    pendingChapterApprovals: data.pendingApprovals,
  });
  const { latestProse, latestHuman, nextAction } = overview;
  const shouldPlanFirstSpec = data.readerContract.ready
    && data.storyHead === null
    && data.specs.length === 0
    && data.pendingApprovals.length === 0;
  const stages = [
    {
      label: "章纲与约束",
      detail: !data.readerContract.ready
        ? `Reader Contract 仍缺 ${data.readerContract.missingSections.length} 项`
        : data.specs.length > 0 ? `${data.specs.length} 个 Chapter Spec` : "Reader Contract 已就绪，尚未生成 Chapter Spec",
      state: !data.readerContract.ready || data.specs.some((spec) => spec.status === "stale" || spec.status === "awaiting-review")
        ? "attention"
        : data.specs.length > 0 ? "done" : "waiting",
    },
    {
      label: "动态调整",
      detail: pendingOutline > 0 ? `${pendingOutline} 项待人工决定` : "没有待决定提案",
      state: pendingOutline > 0 ? "attention" : "done",
    },
    {
      label: "正文质量门",
      detail: latestProse ? `Prose ${latestProse.score ?? "已扫描"} · Human ${latestHuman?.score ?? "待审"}` : "尚无正文报告",
      state: overview.qualityState,
    },
    {
      label: "ChapterCommit",
      detail: data.storyHead ? `HEAD 第 ${data.storyHead.chapter} 章` : "尚无 accepted Commit",
      state: data.storyHead ? "done" : "waiting",
    },
    {
      label: "派生投影",
      detail: !data.storyHead
        ? "等待首个 accepted Commit"
        : data.storyPreflight.passed
          ? "Commit 链与投影一致"
          : `${data.storyPreflight.errors.length} 项阻断`,
      state: !data.storyHead ? "waiting" : data.storyPreflight.passed ? "done" : "attention",
    },
    {
      label: "发布交付",
      detail: publication ? `${publication.platform} · ${publication.status}` : "仅支持手动导出与人工确认",
      state: publication?.status === "failed_external" ? "attention" : "waiting",
    },
  ] as const;

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
      <div className="rounded-2xl border border-border bg-card">
        <header className="border-b border-border px-5 py-4">
          <p className="text-xs font-semibold tracking-[0.14em] text-primary">CANON PIPELINE</p>
          <h2 className="mt-1 text-xl">本书生产链</h2>
          <p className="mt-1 text-sm text-muted-foreground">状态来自持久化结果，不用展示分数替代正式提交状态。</p>
        </header>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
          {stages.map((stage, index) => (
            <div key={stage.label} className="bg-card px-5 py-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <StageState state={stage.state} />
              </div>
              <h3 className="mt-5 font-sans text-sm font-semibold">{stage.label}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{stage.detail}</p>
            </div>
          ))}
        </div>
      </div>
      <aside className="space-y-4">
        <div className={`rounded-2xl border p-5 ${
          nextAction.requiresAttention
            ? "border-amber-500/35 bg-amber-500/[0.07]"
            : "border-primary/25 bg-card"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground">下一步</p>
            <StatusBadge value={nextAction.requiresAttention ? "待处理" : "可继续"} />
          </div>
          <h2 className="mt-3 font-sans text-lg font-semibold">
            {shouldPlanFirstSpec ? "准备第一章具体场景规格" : nextAction.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {shouldPlanFirstSpec
              ? "先运行 Planner 与场景实现器，生成可审阅的角色议程、信息载体、互动链和旁白许可；不会提前生成正文。"
              : nextAction.description}
          </p>
          <ActionButton
            className="mt-5 w-full"
            variant={nextAction.requiresAttention ? "default" : "outline"}
            busy={busy === "plan-first-spec"}
            onClick={() => {
              if (shouldPlanFirstSpec) {
                void act(
                  "plan-first-spec",
                  () => postApi(`/books/${encodeURIComponent(data.bookId)}/plan`, {}),
                  "第一章具体场景规格已生成，请核对后批准。",
                );
              } else if (nextAction.destination === "book") {
                toBook();
              } else {
                setTab(nextAction.destination);
              }
            }}
          >
            {shouldPlanFirstSpec ? "生成具体场景规格" : nextAction.buttonLabel}
            <ArrowRight size={15} />
          </ActionButton>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            待批准提案、质量阻断和失败投影会暂停自动写章。
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">自动写作</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{data.automation.config.enabled ? "已为本书启用" : "保持关闭"}</span>
            <StatusBadge value={data.automation.runtime.paused ? "paused" : data.automation.config.enabled ? "ready" : "manual"} />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            今日已写 {data.automation.runtime.dailyCount} 章；人工编辑状态：{data.automation.runtime.editing ? "占用中" : "空闲"}。
          </p>
        </div>
      </aside>
    </section>
  );
}

function CanonPanel(props: PanelProps) {
  const { data } = props;
  return (
    <section className="space-y-5">
      {data.pendingApprovals.length > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07]">
          <header className="border-b border-amber-500/25 px-5 py-4">
            <h2 className="text-xl">待作者批准正文</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              只有批准的正文哈希可以进入 accepted ChapterCommit；批准后正文若再变化，批准自动失效。
            </p>
          </header>
          <div className="divide-y divide-amber-500/20">
            {data.pendingApprovals.map((pending) => (
              <div key={pending.chapter} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div>
                  <p className="font-medium">第 {pending.chapter} 章 · {pending.title}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground" title={pending.contentHash}>
                    reviewed {pending.reviewedContentHash.slice(0, 12)} · current {pending.contentHash.slice(0, 12)}
                  </p>
                  {pending.proseQuality && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prose {pending.proseQuality.score} · {pending.proseQuality.level} · blocking {pending.proseQuality.blockingCount}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge value={pending.status} />
                  {pending.status === "awaiting-human-approval" && (
                    <ActionButton
                      busy={props.busy === `chapter:${pending.chapter}:approve`}
                      onClick={() => props.act(
                        `chapter:${pending.chapter}:approve`,
                        () => postApi(`/books/${encodeURIComponent(data.bookId)}/chapters/${pending.chapter}/approve`, {}),
                        `第 ${pending.chapter} 章已按当前审查哈希批准并提交正史。`,
                      )}
                    >
                      <ShieldCheck size={14} /> 批准并提交正史
                    </ActionButton>
                  )}
                  {pending.status === "human-editing" && (
                    <ActionButton
                      busy={props.busy === `chapter:${pending.chapter}:review`}
                      onClick={() => props.act(
                        `chapter:${pending.chapter}:review`,
                        () => postApi(`/books/${encodeURIComponent(data.bookId)}/chapters/${pending.chapter}/review`, {}),
                        `第 ${pending.chapter} 章已重新执行全部质量门，请核对新审查哈希。`,
                      )}
                    >
                      <RotateCcw size={14} /> 重新执行全部审查
                    </ActionButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-xl">正史与投影预检</h2>
            <p className="mt-1 text-sm text-muted-foreground">accepted Commit 是唯一权威写入口；Markdown、MemoryDB 与检索索引都是投影。</p>
          </div>
          <StatusBadge value={data.storyPreflight.passed ? "passed" : "blocked"} />
        </header>
        <dl className="grid gap-px bg-border sm:grid-cols-2">
          <CanonicalValue label="HEAD 章节" value={data.storyPreflight.headChapter || "—"} />
          <CanonicalValue label="HEAD Commit" value={data.storyPreflight.headCommitId ?? "尚无"} mono />
          <CanonicalValue label="恢复事务" value={data.storyPreflight.repairedTransactions.length} />
          <CanonicalValue label="预检阻断" value={data.storyPreflight.errors.length} />
        </dl>
        {(data.storyPreflight.errors.length > 0 || data.storyPreflight.warnings.length > 0) && (
          <div className="space-y-4 border-t border-border px-5 py-5">
            <List values={data.storyPreflight.errors} empty="" />
            <List values={data.storyPreflight.warnings} empty="" />
          </div>
        )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl">读者合同与叙事债务</h2>
        <p className="mt-1 text-sm text-muted-foreground">摘要只用于压缩；兑现账本不会覆盖客观事实。</p>
        <div className="mt-4 space-y-3">
          {data.payoffLedger.length === 0 && <Empty text="尚无已登记的读者承诺。" />}
          {data.payoffLedger.slice(-8).map((item) => (
            <div key={item.id} className="rounded-xl border border-border px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge value={item.status} />
                <span className="font-mono text-xs text-muted-foreground">CH {item.targetWindow.from}–{item.targetWindow.to}</span>
              </div>
              <p className="mt-2 text-sm">{item.promise}</p>
            </div>
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}

interface SceneSemanticReport extends QualityReport {
  readonly contentChangedAfterSceneReview?: boolean;
  readonly sceneCount?: number;
  readonly sceneRealizationPassed?: boolean;
  readonly informationDramatizationPassed?: boolean;
  readonly interactionChainPassed?: boolean;
  readonly reviews?: ReadonlyArray<{
    readonly sceneId: string;
    readonly repairIterations: number;
    readonly review: {
      readonly verdict: "pass" | "repair" | "block";
      readonly narrationUnits: ReadonlyArray<{ readonly necessary: boolean; readonly permissionMatched: boolean; readonly excerpt: string }>;
      readonly dialogueTurns: ReadonlyArray<{ readonly respondsToPreviousTurn: boolean; readonly changesInteraction: boolean; readonly informationDump: boolean; readonly excerpt: string }>;
      readonly informationFulfillment: ReadonlyArray<{ readonly delivered: boolean; readonly consequenceVisible: boolean }>;
      readonly interactionFulfillment: ReadonlyArray<{ readonly fulfilled: boolean; readonly missingParts: ReadonlyArray<string> }>;
      readonly unintendedFacts: ReadonlyArray<{ readonly message: string; readonly excerpt: string }>;
      readonly missingDramatization: ReadonlyArray<{ readonly message: string; readonly excerpt: string }>;
    };
  }>;
}

type ReaderContractField =
  | "coreFantasy"
  | "emotionalPromises"
  | "progressionPromises"
  | "relationshipPromises"
  | "mysteryPromises"
  | "identityPromises"
  | "forbiddenBetrayals";

type ReaderContractDraft = Record<ReaderContractField, string>;

const READER_CONTRACT_FIELDS: ReadonlyArray<{
  readonly key: ReaderContractField;
  readonly label: string;
  readonly hint: string;
}> = [
  { key: "coreFantasy", label: "核心幻想", hint: "读者持续获得的核心代入与满足" },
  { key: "emotionalPromises", label: "情绪承诺", hint: "作品长期承诺提供的主要情绪体验" },
  { key: "progressionPromises", label: "成长承诺", hint: "能力、地位或选择空间将如何增长" },
  { key: "relationshipPromises", label: "关系承诺", hint: "关键关系将经历的张力与变化" },
  { key: "mysteryPromises", label: "谜团承诺", hint: "读者等待揭晓的核心问题" },
  { key: "identityPromises", label: "身份承诺", hint: "身份揭露、认可或归属方面的承诺" },
  { key: "forbiddenBetrayals", label: "禁止背叛事项", hint: "作品绝不能无铺垫违背的读者信任" },
];

function SystemPanel(props: PanelProps & { readonly bookId: string }) {
  const { data } = props;
  const failures = data.storySystem.projectionFailures;
  const legacyHistoryNeedsMigration = data.storyPreflight.errors.some((error) =>
    error.startsWith("legacy-history-unmigrated:"));
  const repairable = !data.storyPreflight.passed || failures.length > 0;
  const [migrationPreview, setMigrationPreview] = useState<StoryMigrationReport | null>(
    data.storySystem.latestMigration,
  );
  const effectiveMigrationPreview = migrationPreview ?? data.storySystem.latestMigration;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl">系统与派生投影</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            accepted Commit 是唯一正史来源。记忆库、Markdown 真相文件、检索索引和摘要都可从 Commit 链重建。
          </p>
        </div>
        <StatusBadge value={data.storyPreflight.passed ? "healthy" : "attention"} />
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <CanonicalValue label="accepted Commit" value={data.storySystem.acceptedCommitCount} />
        <CanonicalValue label="rejected Commit" value={data.storySystem.rejectedCommitCount} />
        <CanonicalValue label="待补投影" value={failures.length} />
        <CanonicalValue label="自动发布" value="已禁用" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-5 py-4">
            <h3 className="text-base font-semibold">预检结果</h3>
            <p className="mt-1 text-sm text-muted-foreground">每次写入下一章前都会重新检查 Commit 链、章节哈希、事务和必需投影。</p>
          </header>
          <div className="divide-y divide-border">
            {data.storyPreflight.errors.length === 0 && data.storyPreflight.warnings.length === 0 && failures.length === 0 && (
              <div className="px-5 py-6 text-sm text-emerald-700 dark:text-emerald-300">没有待处理的正史或投影问题。</div>
            )}
            {data.storyPreflight.errors.map((entry) => <SystemIssue key={`error:${entry}`} tone="error" text={entry} />)}
            {data.storyPreflight.warnings.map((entry) => <SystemIssue key={`warning:${entry}`} tone="warning" text={entry} />)}
            {failures.map((entry) => <SystemIssue key={`projection:${entry}`} tone="error" text={`Projection pending: ${entry}`} />)}
          </div>
        </div>
        {legacyHistoryNeedsMigration ? (
          <aside className="rounded-xl border border-amber-500/35 bg-amber-500/[0.07] p-5">
            <BookOpenCheck size={18} className="text-amber-700 dark:text-amber-300" />
            <h3 className="mt-3 text-base font-semibold">迁移旧章节历史</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              先生成只读迁移预览。确认后，系统会备份章节与 story 目录，再建立 Commit 链并重放所有投影。
            </p>
            {!effectiveMigrationPreview ? (
              <ActionButton
                className="mt-5 w-full"
                busy={props.busy === "story-migrate-preview"}
                onClick={() => props.act(
                  "story-migrate-preview",
                  async () => {
                    const report = await postApi<StoryMigrationReport>(
                      `/books/${encodeURIComponent(props.bookId)}/story-migrate`,
                      { apply: false },
                    );
                    setMigrationPreview(report);
                  },
                  "迁移预览已生成，尚未切换正史权限。",
                )}
              >
                预览迁移
              </ActionButton>
            ) : (
              <div className="mt-5 space-y-4">
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border">
                  <MigrationValue label="章节" value={effectiveMigrationPreview.chapterCount} />
                  <MigrationValue label="候选 Commit" value={effectiveMigrationPreview.commitIds.length} />
                </dl>
                <List
                  values={effectiveMigrationPreview.warnings.map(formatStoryMigrationWarning)}
                  empty=""
                />
                <ActionButton
                  className="w-full"
                  busy={props.busy === "story-migrate-apply"}
                  onClick={() => props.act(
                    "story-migrate-apply",
                    async () => {
                      const report = await postApi<StoryMigrationReport>(
                        `/books/${encodeURIComponent(props.bookId)}/story-migrate`,
                        { apply: true, confirmBookId: props.bookId },
                      );
                      setMigrationPreview(report);
                    },
                    "旧章节已备份并迁移到 ChapterCommit 权限，投影已重放。",
                  )}
                >
                  <ShieldCheck size={14} /> 备份并启用 ChapterCommit
                </ActionButton>
                <p className="break-all text-xs leading-5 text-muted-foreground">
                  预览报告：{effectiveMigrationPreview.reportPath}
                </p>
              </div>
            )}
          </aside>
        ) : (
          <aside className="rounded-xl border border-border bg-card p-5">
            <Wrench size={18} className="text-primary" />
            <h3 className="mt-3 text-base font-semibold">修复与重放</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              修复只重放 accepted Commit 的派生数据，不会改写正文、Commit 或事件日志。
            </p>
            <ActionButton
              className="mt-5 w-full"
              variant={repairable ? "default" : "outline"}
              busy={props.busy === "story-repair"}
              onClick={() => props.act(
                "story-repair",
                () => postApi(`/books/${encodeURIComponent(props.bookId)}/story-repair`, {}),
                repairable ? "已完成修复并重新执行预检。" : "已重新执行投影修复与预检。",
              )}
            >
              <RotateCcw size={14} /> {repairable ? "修复投影并复检" : "验证并重放投影"}
            </ActionButton>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              外部发布仍需手动导出、人工上传，并通过外部日志或人工确认回填状态。
            </p>
          </aside>
        )}
      </div>
    </section>
  );
}

interface StoryMigrationReport {
  readonly migrationId: string;
  readonly applied: boolean;
  readonly chapterCount: number;
  readonly commitIds: ReadonlyArray<string>;
  readonly reportPath: string;
  readonly warnings: ReadonlyArray<string>;
}

function MigrationValue({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function SystemIssue({ tone, text }: { readonly tone: "error" | "warning"; readonly text: string }) {
  return (
    <div className={`flex items-start gap-3 px-5 py-4 text-sm ${tone === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p className="min-w-0 break-words">{formatStorySystemIssue(text)}</p>
    </div>
  );
}

function StageState({ state }: { readonly state: "done" | "attention" | "waiting" }) {
  if (state === "done") return <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><Check size={13} /> 就绪</span>;
  if (state === "attention") return <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle size={13} /> 待处理</span>;
  return <span className="text-xs text-muted-foreground">等待</span>;
}

function CanonicalValue({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly mono?: boolean;
}) {
  return (
    <div className="min-w-0 bg-card px-5 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-2 truncate text-sm font-medium ${mono ? "font-mono text-xs" : ""}`} title={String(value)}>{value}</dd>
    </div>
  );
}

function readerContractToDraft(contract: StoryWorkbenchData["readerContract"]): ReaderContractDraft {
  return Object.fromEntries(READER_CONTRACT_FIELDS.map((field) => [
    field.key,
    contract[field.key].join("\n"),
  ])) as ReaderContractDraft;
}

function readerContractFromDraft(draft: ReaderContractDraft): Record<ReaderContractField, string[]> {
  return Object.fromEntries(READER_CONTRACT_FIELDS.map((field) => [
    field.key,
    draft[field.key].split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
  ])) as Record<ReaderContractField, string[]>;
}

function SceneValue({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm leading-6">{value}</dd>
    </div>
  );
}

function SceneCollection({
  title,
  empty,
  children,
}: {
  readonly title: string;
  readonly empty: string;
  readonly children: ReadonlyArray<ReactNode>;
}) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      {children.length > 0
        ? <div className="mt-2 grid gap-3 lg:grid-cols-2">{children}</div>
        : <p className="mt-2 text-xs text-muted-foreground">{empty}</p>}
    </div>
  );
}

function SpecPanel(props: PanelProps) {
  const { data } = props;
  const [readerContractDraft, setReaderContractDraft] = useState<ReaderContractDraft>(() =>
    readerContractToDraft(data.readerContract));
  useEffect(() => {
    setReaderContractDraft(readerContractToDraft(data.readerContract));
  }, [data.readerContract.version]);
  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-xl">Reader Contract</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              正式写作前必须明确七类长期承诺；空合同只能用于开书准备，不会进入 Writer。
            </p>
          </div>
          <StatusBadge value={data.readerContract.ready ? "ready" : "incomplete"} />
        </header>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          {READER_CONTRACT_FIELDS.map((field) => (
            <label key={field.key} className={field.key === "forbiddenBetrayals" ? "lg:col-span-2" : ""}>
              <span className="flex items-center justify-between gap-3 text-sm font-medium">
                {field.label}
                {data.readerContract.missingSections.includes(field.key) && (
                  <span className="text-xs text-amber-700 dark:text-amber-300">必填</span>
                )}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{field.hint}；每行一项。</span>
              <textarea
                value={readerContractDraft[field.key]}
                onChange={(event) => setReaderContractDraft((current) => ({
                  ...current,
                  [field.key]: event.target.value,
                }))}
                rows={3}
                className="mt-2 min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </label>
          ))}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p className="text-xs text-muted-foreground">
            v{data.readerContract.version} · {data.readerContract.ready
              ? "七类承诺已齐全，可以编译正式 Chapter Spec。"
              : `仍缺 ${data.readerContract.missingSections.length} 类承诺，保存后仍会保持写作阻断。`}
          </p>
          <ActionButton
            busy={props.busy === "reader-contract:save"}
            onClick={() => props.act(
              "reader-contract:save",
              () => putApi(`${props.path}/reader-contract`, readerContractFromDraft(readerContractDraft)),
              "Reader Contract 已保存；写章前会重新验证完整性。",
            )}
          >
            <Check size={14} /> 保存 Reader Contract
          </ActionButton>
        </footer>
      </div>
      <div>
        <h2 className="text-xl">Story Constitution</h2>
        <details className="mt-3 rounded-xl border border-border bg-card">
          <summary className="px-4 py-3 text-sm font-medium">查看本书不可妥协规则</summary>
          <pre className="max-h-[420px] overflow-auto border-t border-border p-4 whitespace-pre-wrap text-sm leading-7">{data.constitution}</pre>
        </details>
      </div>
      <div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl">Chapter Specs</h2>
            <p className="mt-1 text-sm text-muted-foreground">stale 或未批准规格不会进入自动写作。</p>
          </div>
          <span className="text-sm text-muted-foreground">{data.specs.length} 个版本头</span>
        </div>
        <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {data.specs.length === 0 && <Empty text="写章时会自动生成首个 Chapter Spec。" />}
          {data.specs.map((spec) => (
            <details key={spec.id} className="group">
              <summary className="flex items-center gap-3 px-4 py-3">
                <span className="w-16 font-mono text-xs text-muted-foreground">CH {spec.chapterNumber}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{spec.chapterGoal}</span>
                <StatusBadge value={spec.status} />
                <span className="text-xs text-muted-foreground">v{spec.version}</span>
              </summary>
              <div className="border-t border-border bg-secondary/20 px-4 py-4 text-sm">
                <p className="font-medium">硬约束</p>
                <List values={spec.hardConstraints} empty="无额外硬约束" />
                <p className="mt-4 font-medium">Required Beats</p>
                <List values={spec.requiredBeats} empty="本章没有人工指定的 hard beat" mono />
                {spec.sceneRealization && (
                  <div className="mt-5 space-y-4">
                    <div>
                      <p className="font-medium">Human Scene Realization</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Writer 将按以下场景逐个生成、语义审查和局部重构，不会自由扩写整章。
                      </p>
                    </div>
                    {spec.sceneRealization.scenes.map((scene) => (
                      <details key={scene.plan.id} className="rounded-lg border border-border bg-card">
                        <summary className="flex items-center gap-3 px-3 py-3">
                          <span className="font-mono text-xs text-muted-foreground">S{scene.plan.order}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {scene.plan.location} · {scene.plan.immediateGoal}
                          </span>
                          <StatusBadge value={scene.plan.status} />
                        </summary>
                        <div className="space-y-5 border-t border-border px-4 py-4">
                          <dl className="grid gap-3 sm:grid-cols-2">
                            <SceneValue label="时间" value={scene.plan.time} />
                            <SceneValue label="风险" value={scene.plan.stakes} />
                            <SceneValue label="阻力目标" value={scene.plan.oppositionGoal} />
                            <SceneValue label="转折" value={scene.plan.turningPoint} />
                            <SceneValue label="抉择" value={scene.plan.decisionPoint} />
                            <SceneValue label="不可逆变化" value={scene.plan.irreversibleChange} />
                          </dl>
                          <SceneCollection title="人物议程" empty="无人物议程">
                            {scene.characterAgendas.map((agenda) => (
                              <div key={agenda.characterId} className="rounded-md border border-border px-3 py-3">
                                <p className="font-medium">{agenda.characterId}</p>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">想要：{agenda.wantsNow}</p>
                                <p className="text-xs leading-5 text-muted-foreground">害怕：{agenda.fearsNow}</p>
                                <p className="text-xs leading-5 text-muted-foreground">策略：{agenda.tactic}</p>
                                <p className="text-xs leading-5 text-muted-foreground">隐藏：{agenda.hides.join("、") || "无"}</p>
                                <p className="text-xs leading-5 text-muted-foreground">不能直说：{agenda.cannotSayDirectly.join("、") || "无"}</p>
                              </div>
                            ))}
                          </SceneCollection>
                          <SceneCollection title="信息传递" empty="本场无必须传递信息">
                            {scene.informationUnits.map((unit) => (
                              <div key={unit.id} className="rounded-md border border-border px-3 py-3">
                                <p className="font-medium">{unit.fact}</p>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                  承载：{unit.selectedCarriers.join(" + ")} · {unit.deliveryMethod}
                                </p>
                                <p className="text-xs leading-5 text-muted-foreground">后果：{unit.consequence}</p>
                                <p className="text-xs leading-5 text-muted-foreground">旁白：{unit.narrationAllowed ? "已申请许可" : "禁止"}</p>
                              </div>
                            ))}
                          </SceneCollection>
                          <SceneCollection title="逐轮互动链" empty="无互动轮次">
                            {scene.interactionTurns.map((turn) => (
                              <div key={turn.order} className="rounded-md border border-border px-3 py-3 text-xs leading-5">
                                <p className="font-medium">#{turn.order} {turn.initiator} → {turn.responder}</p>
                                <p className="mt-1 text-muted-foreground">刺激：{turn.stimulus}</p>
                                <p className="text-muted-foreground">回应：{turn.outwardActionOrDialogue}</p>
                                <p className="text-muted-foreground">策略变化：{turn.strategyAfter}</p>
                                <p className="text-muted-foreground">对方受到影响：{turn.effectOnOtherCharacter}</p>
                              </div>
                            ))}
                          </SceneCollection>
                          <SceneCollection title="旁白许可" empty="本场没有旁白许可；解释性旁白一律禁止">
                            {scene.narrationPermissions.map((permission) => (
                              <div key={permission.informationUnitId} className="rounded-md border border-border px-3 py-3 text-xs leading-5">
                                <p className="font-medium">{permission.reason} · 最多 {permission.maximumChars} 字</p>
                                <p className="mt-1 text-muted-foreground">仅允许：{permission.requiredContent}</p>
                              </div>
                            ))}
                          </SceneCollection>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
                {spec.planningValidation.verdict === "block" && (
                  <div className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/[0.07] p-3">
                    <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
                      <AlertTriangle size={14} /> 具体规划尚未通过
                    </p>
                    <List
                      values={spec.planningValidation.placeholders.map((value) => `占位语：${value}`)}
                      empty=""
                    />
                    <List
                      values={spec.planningValidation.missingFields.map((value) => `缺失：${value}`)}
                      empty=""
                      mono
                    />
                  </div>
                )}
                {spec.status === "awaiting-review" && (
                  <ActionButton
                    className="mt-4"
                    busy={props.busy === `spec:${spec.chapterNumber}:approve`}
                    disabled={spec.planningValidation.verdict === "block"}
                    onClick={() => props.act(
                      `spec:${spec.chapterNumber}:approve`,
                      () => postApi(
                        `${props.path}/spec/${spec.chapterNumber}/approve`,
                        { expectedVersion: spec.version },
                      ),
                      `第 ${spec.chapterNumber} 章 Story Spec 已批准。`,
                    )}
                  >
                    <Check size={14} /> 批准 Story Spec
                  </ActionButton>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function OutlinePanel(props: PanelProps) {
  const proposed = props.data.outlineRevisions.filter((item) => item.status === "proposed");
  return (
    <section>
      <h2 className="text-xl">动态大纲修订</h2>
      <p className="mt-1 text-sm text-muted-foreground">Commit 只产生提案。批准或拒绝后保留版本记录，不直接覆盖历史 Spec。</p>
      <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
        {props.data.outlineRevisions.length === 0 && <Empty text="当前没有动态大纲修订。" />}
        {props.data.outlineRevisions.map((revision) => (
          <div key={revision.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <GitBranch size={16} />
              <code className="text-xs">{revision.id}</code>
              <StatusBadge value={revision.status} />
            </div>
            <List values={revision.reasons} empty="无原因说明" />
            <p className="mt-3 text-xs text-muted-foreground">
              影响 {revision.affectedSpecIds.length} 个 Spec，包含 {revision.proposedChanges.length} 项修改。
            </p>
            {revision.proposedChanges.length > 0 && (
              <details className="mt-3 border border-border bg-muted/30 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">查看将写入后续 Story Spec 的实际变更</summary>
                <div className="mt-3 space-y-3">
                  {revision.proposedChanges.map((change, index) => (
                    <div key={`${change.specId}:${change.field}:${index}`} className="border-l-2 border-primary pl-3">
                      <p className="text-xs font-medium">
                        {outlineFieldLabel(change.field)} · <code>{change.specId}</code>
                      </p>
                      <List values={formatOutlineChangeValue(change.newValue)} empty="无可应用内容" />
                    </div>
                  ))}
                </div>
              </details>
            )}
            {revision.status === "proposed" && (
              <div className="mt-4 flex gap-2">
                <ActionButton
                  busy={props.busy === `${revision.id}:approve`}
                  onClick={() => props.act(
                    `${revision.id}:approve`,
                    () => postApi(`${props.path}/outline/${encodeURIComponent(revision.id)}/decision`, { decision: "approved" }),
                    "动态大纲修订已批准。",
                  )}
                >
                  <Check size={14} /> 批准修订
                </ActionButton>
                <ActionButton
                  variant="outline"
                  busy={props.busy === `${revision.id}:reject`}
                  onClick={() => props.act(
                    `${revision.id}:reject`,
                    () => postApi(`${props.path}/outline/${encodeURIComponent(revision.id)}/decision`, { decision: "rejected" }),
                    "动态大纲修订已拒绝。",
                  )}
                >
                  <X size={14} /> 拒绝修订
                </ActionButton>
              </div>
            )}
          </div>
        ))}
      </div>
      {proposed.length > 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle size={15} /> 有 {proposed.length} 项待人工决定，自动写作保持阻断。
        </p>
      )}
    </section>
  );
}

function outlineFieldLabel(field: string): string {
  if (field === "hardConstraints") return "正史硬约束";
  if (field === "plannedEvents") return "后续计划事件";
  if (field === "acceptanceCriteria") return "阻断验收条件";
  return field;
}

function formatOutlineChangeValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [formatUnknown(value)];
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if (typeof record.description === "string") return record.description;
    }
    return formatUnknown(item);
  });
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function BenchmarkPanel(props: PanelProps) {
  return (
    <section>
      <h2 className="text-xl">对标机制</h2>
      <p className="mt-1 text-sm text-muted-foreground">Writer 只读取已批准的抽象机制，不读取源文本和被禁止的专有细节。</p>
      <div className="mt-4 space-y-4">
        {props.data.benchmarkProfiles.length === 0 && (
          <div className="rounded-xl border border-border bg-card"><Empty text="尚未导入用户合法提供的对标文本。" /></div>
        )}
        {props.data.benchmarkProfiles.map((profile) => (
          <article key={profile.sourceId} className="rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-base font-semibold">{profile.title}</h3>
                <p className="text-xs text-muted-foreground">{profile.roles.join(" · ")}</p>
              </div>
              <span className="text-xs text-muted-foreground">{profile.extractedMechanisms.length} 个机制</span>
            </header>
            <div className="divide-y divide-border">
              {profile.extractedMechanisms.map((mechanism) => (
                <div key={mechanism.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                  <div className="min-w-[240px] flex-1">
                    <p className="text-sm font-medium">{mechanism.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{mechanism.emotionalFunction}</p>
                    {mechanism.prohibitedSourceDetails.length > 0 && (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                        禁止迁移：{mechanism.prohibitedSourceDetails.join("、")}
                      </p>
                    )}
                  </div>
                  <ActionButton
                    variant={mechanism.approved ? "outline" : "default"}
                    busy={props.busy === mechanism.id}
                    onClick={() => props.act(
                      mechanism.id,
                      () => putApi(
                        `${props.path}/benchmark/${encodeURIComponent(profile.sourceId)}/${encodeURIComponent(mechanism.id)}`,
                        { approved: !mechanism.approved },
                      ),
                      mechanism.approved ? "机制已撤销批准。" : "机制已批准，后续 Writer 可读取其抽象规则。",
                    )}
                  >
                    {mechanism.approved ? <X size={14} /> : <Check size={14} />}
                    {mechanism.approved ? "撤销批准" : "批准机制"}
                  </ActionButton>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function QualityPanel(props: PanelProps) {
  const latestHuman = props.data.quality["human-feel"][0];
  const latestScene = props.data.quality["scene-semantic"][0];
  const humanIssues = useMemo(() => collectHumanIssues(latestHuman), [latestHuman]);
  const humanChapter = reportChapter(latestHuman);
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl">质量审查</h2>
        <p className="mt-1 text-sm text-muted-foreground">先看 blocking，再看分数。人工决定只写入审查记录，不改写正史。</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <QualitySummary label="Prose Quality" report={props.data.quality.prose[0]} />
        <QualitySummary label="Scene Semantic" report={latestScene} />
        <QualitySummary label="Human Feel" report={latestHuman} />
        <QualitySummary label="Payoff" report={props.data.quality.payoff[0]} />
      </div>
      <div>
        <h3 className="text-lg">场景语义审查</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          分别验证场景状态变化、信息戏剧化和刺激—反应互动链；三项全部通过才允许进入正史提交。
        </p>
        <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {!latestScene?.reviews?.length && <Empty text="尚无逐场景语义报告。" />}
          {latestScene?.reviews?.map((record) => {
            const narrationFailures = record.review.narrationUnits.filter((unit) => !unit.necessary || !unit.permissionMatched);
            const dialogueFailures = record.review.dialogueTurns.filter((turn) => !turn.respondsToPreviousTurn || !turn.changesInteraction || turn.informationDump);
            const missingInformation = record.review.informationFulfillment.filter((item) => !item.delivered || !item.consequenceVisible);
            const missingTurns = record.review.interactionFulfillment.filter((item) => !item.fulfilled || item.missingParts.length > 0);
            const issues = [
              ...record.review.unintendedFacts.map((issue) => `意外事实：${issue.message}｜${issue.excerpt}`),
              ...record.review.missingDramatization.map((issue) => `未戏剧化：${issue.message}｜${issue.excerpt}`),
              ...narrationFailures.map((unit) => `旁白无许可或无必要：${unit.excerpt}`),
              ...dialogueFailures.map((turn) => `对白未形成刺激—反应：${turn.excerpt}`),
              ...missingInformation.map(() => "必要信息未完整交付或没有可见后果"),
              ...missingTurns.map((turn) => `互动轮缺失：${turn.missingParts.join("、") || "未兑现"}`),
            ];
            return (
              <details key={record.sceneId} className="group">
                <summary className="flex items-center gap-3 px-4 py-3">
                  <code className="text-xs text-muted-foreground">{record.sceneId}</code>
                  <span className="min-w-0 flex-1 text-sm">
                    {record.repairIterations > 0 ? `自动重构 ${record.repairIterations} 轮` : "未触发重构"}
                  </span>
                  <StatusBadge value={record.review.verdict} />
                </summary>
                <div className="border-t border-border bg-secondary/20 px-4 py-4">
                  <List values={issues} empty="场景语义、信息承载和互动链均已兑现。" />
                </div>
              </details>
            );
          })}
        </div>
      </div>
      <div>
        <h3 className="text-lg">真人感问题定位</h3>
        <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {humanIssues.length === 0 && <Empty text="最新报告没有可显示的问题。" />}
          {humanIssues.map((issue) => (
            <div key={issue.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={issue.severity} />
                <span className="text-xs text-muted-foreground">第 {issue.paragraphIndex + 1} 段 · {issue.category}</span>
              </div>
              <p className="mt-2 text-sm font-medium">{issue.message}</p>
              <blockquote className="mt-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm leading-6">{issue.excerpt}</blockquote>
              <p className="mt-2 text-sm text-muted-foreground">{issue.rationale}</p>
              <p className="mt-1 text-sm">建议：{issue.suggestion}</p>
              {humanChapter && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton
                    busy={props.busy === `${issue.id}:accept`}
                    onClick={() => props.act(
                      `${issue.id}:accept`,
                      () => postApi(
                        `${props.path}/human-feel/${humanChapter}/issues/${encodeURIComponent(issue.id)}`,
                        { decision: "accepted" },
                      ),
                      "已接受此问题，记录为待修。",
                    )}
                  >
                    <Check size={14} /> 接受问题
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    busy={props.busy === `${issue.id}:reject`}
                    onClick={() => props.act(
                      `${issue.id}:reject`,
                      () => postApi(
                        `${props.path}/human-feel/${humanChapter}/issues/${encodeURIComponent(issue.id)}`,
                        { decision: "rejected" },
                      ),
                      "已拒绝此问题，保留审计记录。",
                    )}
                  >
                    <X size={14} /> 拒绝问题
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    busy={props.busy === `${issue.id}:lock`}
                    onClick={() => props.act(
                      `${issue.id}:lock`,
                      () => postApi(
                        `${props.path}/human-feel/${humanChapter}/paragraphs/${issue.paragraphIndex}/lock`,
                        { locked: true },
                      ),
                      `第 ${issue.paragraphIndex + 1} 段已锁定，真人感重审将跳过该段。`,
                    )}
                  >
                    <Lock size={14} /> 锁定段落
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AutomationPanel(props: PanelProps) {
  const config = props.data.automation.config;
  const runtime = props.data.automation.runtime;
  const [draft, setDraft] = useState(config);
  useEffect(() => setDraft(config), [config]);
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl">单书自动化</h2>
        <p className="mt-1 text-sm text-muted-foreground">默认关闭。人工编辑、stale Spec、待批大纲和投影失败都会阻止自动写章。</p>
      </div>
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-4">
          <div>
            <p className="text-sm font-medium">{config.enabled ? "已允许守护进程调度" : "未加入自动写作队列"}</p>
            <p className="mt-1 text-xs text-muted-foreground">今天已写 {runtime.dailyCount} 章</p>
          </div>
          <ActionButton
            busy={props.busy === "automation-enabled"}
            variant={config.enabled ? "outline" : "default"}
            onClick={() => props.act(
              "automation-enabled",
              () => putApi(`${props.path}/automation`, { enabled: !config.enabled }),
              config.enabled ? "单书自动化已关闭。" : "单书自动化已启用。",
            )}
          >
            {config.enabled ? <Pause size={14} /> : <Play size={14} />}
            {config.enabled ? "关闭自动化" : "启用自动化"}
          </ActionButton>
        </div>
        <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          <AutomationValue label="优先级" value={config.priority} />
          <AutomationValue label="每轮章数" value={config.chaptersPerCycle} />
          <AutomationValue label="单书每日上限" value={config.maxChaptersPerDay} />
          <AutomationValue label="最小间隔" value={`${config.minIntervalMinutes} 分钟`} />
        </dl>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AutomationNumber label="优先级" value={draft.priority} min={0} max={100} onChange={(priority) => setDraft({ ...draft, priority })} />
          <AutomationNumber label="每轮章数" value={draft.chaptersPerCycle} min={1} max={20} onChange={(chaptersPerCycle) => setDraft({ ...draft, chaptersPerCycle })} />
          <AutomationNumber label="单书每日上限" value={draft.maxChaptersPerDay} min={1} max={100} onChange={(maxChaptersPerDay) => setDraft({ ...draft, maxChaptersPerDay })} />
          <AutomationNumber label="最小间隔（分钟）" value={draft.minIntervalMinutes} min={0} max={1440} onChange={(minIntervalMinutes) => setDraft({ ...draft, minIntervalMinutes })} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <AutomationToggle label="daemon 启动时运行" checked={draft.runOnDaemonStart} onChange={(runOnDaemonStart) => setDraft({ ...draft, runOnDaemonStart })} />
          <AutomationToggle label="Commit 前人工批准" checked={draft.requireHumanApprovalBeforeCommit} onChange={(requireHumanApprovalBeforeCommit) => setDraft({ ...draft, requireHumanApprovalBeforeCommit })} />
          <AutomationToggle label="发布前人工批准" checked={draft.requireHumanApprovalBeforePublish} onChange={(requireHumanApprovalBeforePublish) => setDraft({ ...draft, requireHumanApprovalBeforePublish })} />
        </div>
        <ActionButton
          className="mt-4"
          busy={props.busy === "automation-policy"}
          onClick={() => props.act(
            "automation-policy",
            () => putApi(`${props.path}/automation`, draft),
            "单书调度策略已保存。",
          )}
        >
          保存调度策略
        </ActionButton>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">运行保护</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {runtime.paused ? `已暂停：${runtime.pauseReason ?? "无原因"}` : runtime.editing ? "人工编辑中" : "可参与资格检查"}
            </p>
          </div>
          <div className="flex gap-2">
            <ActionButton
              busy={props.busy === "pause"}
              variant="outline"
              onClick={() => props.act(
                "pause",
                () => postApi(`${props.path}/automation-state`, { paused: !runtime.paused, reason: "Studio manual pause" }),
                runtime.paused ? "已恢复调度资格。" : "已持久暂停。",
              )}
            >
              {runtime.paused ? <Play size={14} /> : <Pause size={14} />}
              {runtime.paused ? "恢复调度" : "暂停调度"}
            </ActionButton>
            <ActionButton
              busy={props.busy === "editing"}
              variant="outline"
              onClick={() => props.act(
                "editing",
                () => postApi(`${props.path}/automation-state`, { editing: !runtime.editing }),
                runtime.editing ? "已退出人工编辑保护。" : "已进入人工编辑保护。",
              )}
            >
              <Lock size={14} /> {runtime.editing ? "结束编辑" : "标记编辑中"}
            </ActionButton>
          </div>
        </div>
        {runtime.lastError && <p className="mt-3 text-sm text-destructive">{runtime.lastError}</p>}
      </div>
    </section>
  );
}

function PublishingPanel(props: PanelProps) {
  const [platform, setPlatform] = useState<"fanqie" | "qidian">("fanqie");
  const [logText, setLogText] = useState("");
  const records = props.data.publications.filter((record) => record.platform === platform);
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl">发布导出</h2>
        <p className="mt-1 text-sm text-muted-foreground">自动发布未启用。只导出 accepted Commit，生成 ZIP 不代表发布成功，外部状态必须确认或导入日志。</p>
      </div>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        本版本不包含向番茄、起点或其他平台自动上传的能力。此处只生成手动交付包，并记录人工确认的外部结果。
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">平台</span>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as "fanqie" | "qidian")}
            className="rounded-lg border border-input bg-background px-3 py-2"
          >
            <option value="fanqie">番茄批量发布助手</option>
            <option value="qidian">起点发布包</option>
          </select>
        </label>
        <ActionButton
          busy={props.busy === "publication-export"}
          onClick={() => props.act(
            "publication-export",
            () => postApi(`${props.path}/publication/export`, {
              platform,
              format: "zip",
              chapterFileFormat: "md",
            }),
            "发布包已生成，状态仍为 exported。",
          )}
        >
          <Download size={14} /> 生成 ZIP 发布包
        </ActionButton>
      </div>
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-base font-semibold">外部状态</h3>
        </div>
        <div className="divide-y divide-border">
          {records.length === 0 && <Empty text="此平台还没有导出记录。" />}
          {records.map((record) => (
            <div key={`${record.chapterCommitId}:${record.platform}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-16 font-mono">CH {record.chapterNumber}</span>
              <span className="min-w-0 flex-1 truncate">{record.exportedFileName ?? record.chapterCommitId}</span>
              <StatusBadge value={record.status} />
              {record.status === "exported" && (
                <ActionButton
                  size="sm"
                  variant="outline"
                  busy={props.busy === `publication-handoff:${record.chapterCommitId}`}
                  onClick={() => props.act(
                    `publication-handoff:${record.chapterCommitId}`,
                    () => postApi(`${props.path}/publication/${record.chapterNumber}/status`, {
                      platform,
                      chapterCommitId: record.chapterCommitId,
                      status: "handed_to_extension",
                    }),
                    `第 ${record.chapterNumber} 章已确认交给外部助手。`,
                  )}
                >
                  确认交付
                </ActionButton>
              )}
              {record.status === "handed_to_extension" && (
                <ActionButton
                  size="sm"
                  busy={props.busy === `publication-success:${record.chapterCommitId}`}
                  onClick={() => props.act(
                    `publication-success:${record.chapterCommitId}`,
                    () => postApi(`${props.path}/publication/${record.chapterNumber}/status`, {
                      platform,
                      chapterCommitId: record.chapterCommitId,
                      status: "published_external",
                    }),
                    `第 ${record.chapterNumber} 章已由人工确认发布成功。`,
                  )}
                >
                  确认发布成功
                </ActionButton>
              )}
              {!["published_external", "failed_external"].includes(record.status) && (
                <ActionButton
                  size="sm"
                  variant="ghost"
                  busy={props.busy === `publication-failed:${record.chapterCommitId}`}
                  onClick={() => props.act(
                    `publication-failed:${record.chapterCommitId}`,
                    () => postApi(`${props.path}/publication/${record.chapterNumber}/status`, {
                      platform,
                      chapterCommitId: record.chapterCommitId,
                      status: "failed_external",
                    }),
                    `第 ${record.chapterNumber} 章已标记为外部发布失败。`,
                  )}
                >
                  标记失败
                </ActionButton>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <label className="text-sm font-medium" htmlFor="external-publication-log">导入外部助手日志</label>
        <textarea
          id="external-publication-log"
          value={logText}
          onChange={(event) => setLogText(event.target.value)}
          rows={5}
          placeholder="粘贴 JSON 日志，或包含“第1章 上传成功”的文本日志"
          className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
        <ActionButton
          busy={props.busy === "publication-log"}
          variant="outline"
          disabled={!logText.trim()}
          onClick={() => props.act(
            "publication-log",
            () => postApi(`${props.path}/publication/import-log`, { platform, log: logText }),
            "外部日志已导入，匹配章节的状态已更新。",
          )}
        >
          <Upload size={14} /> 导入发布日志
        </ActionButton>
      </div>
    </section>
  );
}

interface PanelProps {
  readonly data: StoryWorkbenchData;
  readonly path: string;
  readonly busy: string | null;
  readonly act: (key: string, action: () => Promise<unknown>, message: string) => Promise<void>;
}

function QualitySummary({ label, report }: { readonly label: string; readonly report?: QualityReport }) {
  return (
    <div className="min-w-[180px] flex-1 rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {report ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-2xl font-semibold">{report.score ?? "已生成"}</span>
          <StatusBadge value={report.level ?? report.verdict ?? report.finalStatus ?? "report"} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">暂无报告</p>
      )}
    </div>
  );
}

function AutomationValue({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function AutomationNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-input bg-background px-3 py-2"
      />
    </label>
  );
}

function AutomationToggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function ActionButton({
  busy,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { readonly busy?: boolean }) {
  return (
    <Button {...props} disabled={disabled || busy}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : children}
    </Button>
  );
}

function StatusBadge({ value }: { readonly value: string }) {
  const risky = /block|failed|stale|rejected|overdue|error/i.test(value);
  const good = /pass|clean|approved|accepted|published_external|done/i.test(value);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
      risky
        ? "bg-destructive/10 text-destructive"
        : good
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-secondary text-secondary-foreground"
    }`}>
      {value}
    </span>
  );
}

function List({
  values,
  empty,
  mono,
}: {
  readonly values: ReadonlyArray<string>;
  readonly empty: string;
  readonly mono?: boolean;
}) {
  if (values.length === 0) return <p className="mt-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className={`mt-2 list-disc space-y-1 pl-5 text-sm ${mono ? "font-mono text-xs" : ""}`}>
      {values.map((value) => <li key={value}>{value}</li>)}
    </ul>
  );
}

function Empty({ text }: { readonly text: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <BookOpenCheck size={22} className="mx-auto text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function WorkbenchSkeleton() {
  return (
    <div aria-label="正在加载故事工作台" className="space-y-5">
      <div className="h-10 w-56 animate-pulse rounded bg-muted" />
      <div className="h-11 animate-pulse rounded bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

function collectHumanIssues(report: HumanFeelReport | undefined): ReadonlyArray<HumanFeelIssue> {
  if (!report) return [];
  const groups = [
    report.blockingIssues,
    report.expositionIssues,
    report.decorativeEnvironmentIssues,
    report.genericMetaphorIssues,
    report.emptyActionIssues,
    report.redundantThoughtIssues,
    report.artificialDialogueIssues,
    report.reactionCouplingIssues,
    report.sceneStagnationIssues,
    report.overNeatPlotIssues,
    report.excessiveExplanationIssues,
  ];
  return [...new Map(groups.flatMap((group) => group ?? []).map((issue) => [issue.id, issue])).values()];
}

function reportChapter(report: QualityReport | undefined): number | null {
  if (report?.chapter && Number.isInteger(report.chapter)) return report.chapter;
  const match = report?.reportPath.match(/chapter-(\d+)/);
  return match?.[1] ? Number(match[1]) : null;
}

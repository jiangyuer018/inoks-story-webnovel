import { PipelineRunner } from "./runner.js";
import type { PipelineConfig } from "./runner.js";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import { resolveBookAutomation } from "../models/book.js";
import type { QualityGates, DetectionConfig } from "../models/project.js";
import { dispatchWebhookEvent } from "../notify/dispatcher.js";
import { detectChapter, detectAndRewrite } from "./detection-runner.js";
import type { Logger } from "../utils/logger.js";
import { AutomationStateStore, type AutomationRuntimeState } from "./automation-state-store.js";
import { DynamicOutlineRevisionStore } from "../narrative-research/dynamic-outline-engine.js";
import { StorySpecStore } from "../story-spec/spec-store.js";

export interface SchedulerConfig extends PipelineConfig {
  readonly radarCron: string;
  readonly writeCron: string;
  readonly maxConcurrentBooks: number;
  readonly chaptersPerCycle: number;
  readonly retryDelayMs: number;
  readonly cooldownAfterChapterMs: number;
  readonly maxChaptersPerDay: number;
  readonly qualityGates?: QualityGates;
  readonly detection?: DetectionConfig;
  readonly onChapterComplete?: (bookId: string, chapter: number, status: string) => void;
  readonly onError?: (bookId: string, error: Error) => void;
  readonly onPause?: (bookId: string, reason: string) => void;
}

interface ScheduledTask {
  readonly name: string;
  readonly intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
}

export class Scheduler {
  private readonly pipeline: PipelineRunner;
  private readonly state: StateManager;
  private readonly config: SchedulerConfig;
  private tasks: ScheduledTask[] = [];
  private running = false;
  private writeCycleInFlight: Promise<void> | null = null;
  private radarScanInFlight: Promise<void> | null = null;

  private readonly log?: Logger;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.pipeline = new PipelineRunner(config);
    this.state = new StateManager(config.projectRoot);
    this.log = config.logger?.child("scheduler");
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (await this.hasRunOnStartBook()) {
      await this.triggerWriteCycle(true);
    }

    // Schedule recurring write cycle
    const writeCycleMs = this.cronToMs(this.config.writeCron);
    const writeTask: ScheduledTask = {
      name: "write-cycle",
      intervalMs: writeCycleMs,
    };
    writeTask.timer = setInterval(() => {
      this.triggerWriteCycle().catch((e) => {
        this.config.onError?.("scheduler", e as Error);
      });
    }, writeCycleMs);
    this.tasks.push(writeTask);

    // Schedule radar scan
    const radarMs = this.cronToMs(this.config.radarCron);
    const radarTask: ScheduledTask = {
      name: "radar-scan",
      intervalMs: radarMs,
    };
    radarTask.timer = setInterval(() => {
      this.triggerRadarScan().catch((e) => {
        this.config.onError?.("radar", e as Error);
      });
    }, radarMs);
    this.tasks.push(radarTask);
  }

  stop(): void {
    this.running = false;
    for (const task of this.tasks) {
      if (task.timer) clearInterval(task.timer);
    }
    this.tasks = [];
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async triggerWriteCycle(runOnStartOnly = false): Promise<void> {
    if (this.writeCycleInFlight) {
      this.log?.warn("Write cycle still running, skipping overlapping tick");
      return;
    }

    const cycle = this.runWriteCycle(runOnStartOnly).finally(() => {
      if (this.writeCycleInFlight === cycle) {
        this.writeCycleInFlight = null;
      }
    });
    this.writeCycleInFlight = cycle;
    await cycle;
  }

  private async triggerRadarScan(): Promise<void> {
    if (this.radarScanInFlight) {
      this.log?.warn("Radar scan still running, skipping overlapping tick");
      return;
    }

    const scan = this.runRadarScan().finally(() => {
      if (this.radarScanInFlight === scan) {
        this.radarScanInFlight = null;
      }
    });
    this.radarScanInFlight = scan;
    await scan;
  }

  async pauseBook(bookId: string, reason = "Paused by user"): Promise<void> {
    await this.automationStore(bookId).update({ paused: true, pauseReason: reason });
  }

  async resumeBook(bookId: string): Promise<void> {
    await this.automationStore(bookId).update({
      paused: false,
      pauseReason: undefined,
      consecutiveFailures: 0,
      failureDimensions: {},
      lastError: undefined,
    });
  }

  async setBookEditing(bookId: string, editing: boolean): Promise<void> {
    await this.automationStore(bookId).update({ editing });
  }

  async getBookAutomationState(bookId: string): Promise<AutomationRuntimeState> {
    return this.automationStore(bookId).load();
  }

  async isBookPaused(bookId: string): Promise<boolean> {
    return (await this.getBookAutomationState(bookId)).paused;
  }

  private get gates(): QualityGates {
    return this.config.qualityGates ?? {
      maxAuditRetries: 2,
      pauseAfterConsecutiveFailures: 3,
      retryTemperatureStep: 0.1,
    };
  }

  private async runWriteCycle(runOnStartOnly = false): Promise<void> {
    const candidates = await this.loadEligibleBooks(runOnStartOnly);
    const globalCount = candidates.allStates.reduce((sum, item) => sum + item.state.dailyCount, 0);
    if (globalCount >= this.config.maxChaptersPerDay) {
      this.log?.info(`Daily cap reached (${this.config.maxChaptersPerDay}), skipping cycle`);
      return;
    }

    let remaining = this.config.maxChaptersPerDay - globalCount;
    const booksToWrite = candidates.eligible
      .sort((left, right) =>
        right.automation.priority - left.automation.priority
        || timestamp(left.state.lastWrittenAt) - timestamp(right.state.lastWrittenAt)
        || left.id.localeCompare(right.id))
      .slice(0, this.config.maxConcurrentBooks)
      .map((book) => {
        const budget = Math.min(
          book.automation.chaptersPerCycle,
          book.automation.maxChaptersPerDay - book.state.dailyCount,
          remaining,
        );
        remaining -= budget;
        return { ...book, budget };
      })
      .filter((book) => book.budget > 0);

    await Promise.all(
      booksToWrite.map((book) => this.processBook(book.id, book.config, book.state, book.budget)),
    );
  }

  /** Process a single book: write chaptersPerCycle chapters with retry + cooldown. */
  private async processBook(
    bookId: string,
    bookConfig: BookConfig,
    initialState: AutomationRuntimeState,
    chapterBudget: number,
  ): Promise<void> {
    const automation = resolveBookAutomation(bookConfig.automation);
    let runtime = initialState;
    for (let i = 0; i < chapterBudget; i++) {
      if (!this.running) return;
      if (runtime.paused || runtime.editing) return;
      if (runtime.dailyCount >= automation.maxChaptersPerDay) return;

      // Cooldown between chapters (skip for the first one)
      if (i > 0 && this.config.cooldownAfterChapterMs > 0) {
        await this.sleep(this.config.cooldownAfterChapterMs);
      }

      const success = await this.writeOneChapter(bookId, bookConfig);
      if (!success) {
        runtime = await this.automationStore(bookId).load();
        const failures = runtime.consecutiveFailures;
        if (failures <= this.gates.maxAuditRetries && this.config.retryDelayMs > 0) {
          this.log?.warn(`${bookId} retrying in ${this.config.retryDelayMs}ms`);
          await this.sleep(this.config.retryDelayMs);
          const retrySuccess = await this.writeOneChapter(bookId, bookConfig);
          if (!retrySuccess) break; // Stop this book's cycle on second failure
        } else {
          break; // Stop this book's cycle
        }
      } else {
        runtime = await this.automationStore(bookId).load();
      }
    }
  }

  /** Write one chapter for a book. Returns true if approved. */
  private async writeOneChapter(bookId: string, bookConfig: BookConfig): Promise<boolean> {
    try {
      // Compute temperature override: base 0.7 + failures * step
      const runtime = await this.automationStore(bookId).load();
      const failures = runtime.consecutiveFailures;
      const tempOverride = failures > 0
        ? Math.min(1.2, 0.7 + failures * this.gates.retryTemperatureStep)
        : undefined;

      const result = await this.pipeline.writeNextChapter(bookId, undefined, tempOverride);

      if (result.status === "ready-for-review") {
        await this.automationStore(bookId).update({
          consecutiveFailures: 0,
          failureDimensions: {},
          lastError: undefined,
          lastWrittenAt: new Date().toISOString(),
          dailyCount: runtime.dailyCount + 1,
        });

        // Auto-detection loop after successful audit
        if (this.config.detection?.enabled) {
          await this.runDetection(bookId, bookConfig, result.chapterNumber);
        }

        this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
        return true;
      }

      // Audit failed — apply quality gates
      const issueCategories = result.auditResult.issues.map((i) => i.category);
      await this.handleAuditFailure(bookId, result.chapterNumber, issueCategories);
      this.config.onChapterComplete?.(bookId, result.chapterNumber, result.status);
      return false;
    } catch (e) {
      this.config.onError?.(bookId, e as Error);
      await this.handleAuditFailure(bookId, 0, [], e as Error);
      return false;
    }
  }

  private async runDetection(
    bookId: string,
    bookConfig: BookConfig,
    chapterNumber: number,
  ): Promise<void> {
    if (!this.config.detection) return;
    try {
      const bookDir = this.state.bookDir(bookId);
      const chapterContent = await this.readChapterContent(bookDir, chapterNumber);
      const detResult = await detectChapter(
        this.config.detection,
        chapterContent,
        chapterNumber,
      );
      if (!detResult.passed && this.config.detection.autoRewrite) {
        await detectAndRewrite(
          this.config.detection,
          { client: this.config.client, model: this.config.model, projectRoot: this.config.projectRoot },
          bookDir,
          chapterContent,
          chapterNumber,
          bookConfig.genre,
        );
      }
    } catch (e) {
      this.config.onError?.(bookId, e as Error);
    }
  }

  private async handleAuditFailure(
    bookId: string,
    chapterNumber: number,
    issueCategories: ReadonlyArray<string> = [],
    error?: Error,
  ): Promise<void> {
    const store = this.automationStore(bookId);
    const runtime = await store.load();
    const failures = runtime.consecutiveFailures + 1;
    const dimensions = { ...runtime.failureDimensions };

    if (issueCategories.length > 0) {
      for (const cat of issueCategories) {
        dimensions[cat] = (dimensions[cat] ?? 0) + 1;
      }

      for (const [dimension, count] of Object.entries(dimensions)) {
        if (count >= 3) {
          await this.emitDiagnosticAlert(bookId, chapterNumber, dimension, count);
        }
      }
    }

    const gates = this.gates;

    if (failures <= gates.maxAuditRetries) {
      await store.update({
        consecutiveFailures: failures,
        failureDimensions: dimensions,
        lastError: error?.message,
      });
      this.log?.warn(`${bookId} audit failed (${failures}/${gates.maxAuditRetries}), will retry`);
      return;
    }

    if (failures >= gates.pauseAfterConsecutiveFailures) {
      const reason = `${failures} consecutive audit failures (threshold: ${gates.pauseAfterConsecutiveFailures})`;
      await store.update({
        paused: true,
        pauseReason: reason,
        consecutiveFailures: failures,
        failureDimensions: dimensions,
        lastError: error?.message,
      });
      this.log?.error(`${bookId} PAUSED: ${reason}`);
      this.config.onPause?.(bookId, reason);

      if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
        await dispatchWebhookEvent(this.config.notifyChannels, {
          event: "pipeline-error",
          bookId,
          chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
          timestamp: new Date().toISOString(),
          data: { reason, consecutiveFailures: failures },
        });
      }
      return;
    }
    await store.update({
      consecutiveFailures: failures,
      failureDimensions: dimensions,
      lastError: error?.message,
    });
  }

  private async hasRunOnStartBook(): Promise<boolean> {
    for (const id of await this.state.listBooks()) {
      const config = await this.state.loadBookConfig(id);
      const automation = resolveBookAutomation(config.automation);
      if (automation.enabled && automation.runOnDaemonStart) return true;
    }
    return false;
  }

  private async loadEligibleBooks(runOnStartOnly = false): Promise<{
    readonly eligible: Array<{
      readonly id: string;
      readonly config: BookConfig;
      readonly automation: ReturnType<typeof resolveBookAutomation>;
      readonly state: AutomationRuntimeState;
    }>;
    readonly allStates: Array<{ readonly id: string; readonly state: AutomationRuntimeState }>;
  }> {
    const now = Date.now();
    const eligible: Array<{
      id: string;
      config: BookConfig;
      automation: ReturnType<typeof resolveBookAutomation>;
      state: AutomationRuntimeState;
    }> = [];
    const allStates: Array<{ id: string; state: AutomationRuntimeState }> = [];
    for (const id of await this.state.listBooks()) {
      const [config, runtime] = await Promise.all([
        this.state.loadBookConfig(id),
        this.automationStore(id).load(),
      ]);
      allStates.push({ id, state: runtime });
      const automation = resolveBookAutomation(config.automation);
      if (!automation.enabled || !["active", "outlining"].includes(config.status)) continue;
      if (runOnStartOnly && !automation.runOnDaemonStart) continue;
      if (runtime.paused || runtime.editing || runtime.dailyCount >= automation.maxChaptersPerDay) continue;
      if (automation.requireHumanApprovalBeforeCommit) continue;
      if (runtime.lastWrittenAt
        && now - Date.parse(runtime.lastWrittenAt) < automation.minIntervalMinutes * 60_000) continue;
      if (await this.hasUnapprovedPlanningChange(id)) continue;
      eligible.push({ id, config, automation, state: runtime });
    }
    return { eligible, allStates };
  }

  private async hasUnapprovedPlanningChange(bookId: string): Promise<boolean> {
    const bookDir = this.state.bookDir(bookId);
    const revisions = await new DynamicOutlineRevisionStore(bookDir).list();
    if (revisions.some((revision) => revision.status === "proposed")) return true;
    const spec = await new StorySpecStore(bookDir).loadChapter(
      await this.nextChapterNumber(bookId),
    );
    return spec?.status === "stale";
  }

  private async nextChapterNumber(bookId: string): Promise<number> {
    return this.state.getNextChapterNumber(bookId);
  }

  private automationStore(bookId: string): AutomationStateStore {
    return new AutomationStateStore(this.state.bookDir(bookId));
  }

  private async runRadarScan(): Promise<void> {
    try {
      await this.pipeline.runRadar();
    } catch (e) {
      this.config.onError?.("radar", e as Error);
    }
  }

  private async emitDiagnosticAlert(
    bookId: string,
    chapterNumber: number,
    dimension: string,
    count: number,
  ): Promise<void> {
    this.log?.warn(`DIAGNOSTIC: ${bookId} has ${count} failures in dimension "${dimension}"`);

    if (this.config.notifyChannels && this.config.notifyChannels.length > 0) {
      await dispatchWebhookEvent(this.config.notifyChannels, {
        event: "diagnostic-alert",
        bookId,
        chapterNumber: chapterNumber > 0 ? chapterNumber : undefined,
        timestamp: new Date().toISOString(),
        data: { dimension, failureCount: count },
      });
    }
  }

  private async readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const chaptersDir = join(bookDir, "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(chapterNumber).padStart(4, "0");
    const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
    if (!chapterFile) {
      throw new Error(`Chapter ${chapterNumber} file not found in ${chaptersDir}`);
    }
    const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
    const lines = raw.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
  }

  private cronToMs(cron: string): number {
    const parts = cron.split(" ");
    if (parts.length < 5) return 24 * 60 * 60 * 1000;

    const minute = parts[0]!;
    const hour = parts[1]!;

    // "*/N * * * *" → every N minutes
    if (minute.startsWith("*/")) {
      const interval = parseInt(minute.slice(2), 10);
      return interval * 60 * 1000;
    }

    // "0 */N * * *" → every N hours
    if (hour.startsWith("*/")) {
      const interval = parseInt(hour.slice(2), 10);
      return interval * 60 * 60 * 1000;
    }

    // Fixed time → treat as daily
    return 24 * 60 * 60 * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function timestamp(value: string | undefined): number {
  return value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
}

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scheduler, type SchedulerConfig } from "../pipeline/scheduler.js";
import { AutomationStateStore } from "../pipeline/automation-state-store.js";

const roots: string[] = [];

function config(projectRoot: string): SchedulerConfig {
  return {
    client: {
      provider: "openai",
      apiFormat: "chat",
      stream: false,
      defaults: { temperature: 0.7, maxTokens: 1024, thinkingBudget: 0 },
    } as SchedulerConfig["client"],
    model: "test-model",
    projectRoot,
    radarCron: "*/1 * * * *",
    writeCron: "*/1 * * * *",
    maxConcurrentBooks: 1,
    chaptersPerCycle: 1,
    retryDelayMs: 0,
    cooldownAfterChapterMs: 0,
    maxChaptersPerDay: 10,
  };
}

async function addBook(
  root: string,
  id: string,
  automation?: Record<string, unknown>,
): Promise<string> {
  const bookDir = join(root, "books", id);
  await mkdir(bookDir, { recursive: true });
  await writeFile(join(bookDir, "book.json"), JSON.stringify({
    id,
    title: id,
    platform: "other",
    genre: "other",
    status: "active",
    targetChapters: 10,
    chapterWordCount: 2200,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...(automation ? { automation } : {}),
  }), "utf-8");
  return bookDir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("Scheduler book automation", () => {
  it("does not write books unless automation is explicitly enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-scheduler-"));
    roots.push(root);
    await addBook(root, "disabled");
    await addBook(root, "enabled", { enabled: true, minIntervalMinutes: 0 });
    const scheduler = new Scheduler(config(root));
    const processBook = vi.spyOn(
      scheduler as unknown as { processBook: (...args: unknown[]) => Promise<void> },
      "processBook",
    ).mockResolvedValue(undefined);
    (scheduler as unknown as { running: boolean }).running = true;

    await (scheduler as unknown as { runWriteCycle: () => Promise<void> }).runWriteCycle();

    expect(processBook).toHaveBeenCalledTimes(1);
    expect(processBook.mock.calls[0]?.[0]).toBe("enabled");
  });

  it("selects the longest-waiting book instead of static directory order", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-scheduler-"));
    roots.push(root);
    const first = await addBook(root, "a-first", { enabled: true, minIntervalMinutes: 0 });
    const waiting = await addBook(root, "z-waiting", { enabled: true, minIntervalMinutes: 0 });
    await new AutomationStateStore(first).update({ lastWrittenAt: "2026-07-29T10:00:00.000Z" });
    await new AutomationStateStore(waiting).update({ lastWrittenAt: "2026-07-28T10:00:00.000Z" });
    const scheduler = new Scheduler(config(root));
    const processBook = vi.spyOn(
      scheduler as unknown as { processBook: (...args: unknown[]) => Promise<void> },
      "processBook",
    ).mockResolvedValue(undefined);
    (scheduler as unknown as { running: boolean }).running = true;

    await (scheduler as unknown as { runWriteCycle: () => Promise<void> }).runWriteCycle();

    expect(processBook.mock.calls[0]?.[0]).toBe("z-waiting");
  });

  it("persists pause and editing protection across Scheduler instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-scheduler-"));
    roots.push(root);
    await addBook(root, "book", { enabled: true });
    const first = new Scheduler(config(root));
    await first.pauseBook("book", "manual review");
    await first.setBookEditing("book", true);

    const second = new Scheduler(config(root));
    expect(await second.isBookPaused("book")).toBe(true);
    expect((await second.getBookAutomationState("book")).editing).toBe(true);

    await second.resumeBook("book");
    expect(await first.isBookPaused("book")).toBe(false);
  });
});

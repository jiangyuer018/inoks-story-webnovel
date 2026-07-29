import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer } from "../api/server.js";

describe("Story workbench API", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-workbench-"));
    const bookDir = join(root, "books", "demo");
    await mkdir(bookDir, { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({
      id: "demo",
      title: "Demo",
      platform: "qidian",
      genre: "urban",
      status: "active",
      targetChapters: 100,
      chapterWordCount: 2500,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    }), "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns durable defaults without requiring prior reports or specs", async () => {
    const app = createStudioServer({} as never, root);
    const response = await app.request("/api/v1/books/demo/story-workbench");
    expect(response.status).toBe(200);
    const body = await response.json() as {
      constitution: string;
      specs: unknown[];
      automation: { config: { enabled: boolean }; runtime: { paused: boolean } };
      publications: unknown[];
      storyPreflight: { passed: boolean; errors: unknown[] };
    };
    expect(body.constitution).toContain("正史唯一来源");
    expect(body.specs).toEqual([]);
    expect(body.automation.config.enabled).toBe(false);
    expect(body.automation.runtime.paused).toBe(false);
    expect(body.publications).toEqual([]);
    expect(body.storyPreflight).toMatchObject({ passed: true, errors: [] });
    expect(await readFile(
      join(root, "books", "demo", ".inoks-story-webnovel", "story-spec", "constitution.md"),
      "utf-8",
    )).toContain("场景优先");
  });

  it("persists explicit automation configuration and manual pause", async () => {
    const app = createStudioServer({} as never, root);
    const configured = await app.request("/api/v1/books/demo/story-workbench/automation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, priority: 4 }),
    });
    expect(configured.status).toBe(200);

    const paused = await app.request("/api/v1/books/demo/story-workbench/automation-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true, reason: "editor review" }),
    });
    expect(paused.status).toBe(200);

    const body = await (await app.request("/api/v1/books/demo/story-workbench")).json() as {
      automation: {
        config: { enabled: boolean; priority: number };
        runtime: { paused: boolean; pauseReason?: string };
      };
    };
    expect(body.automation.config).toMatchObject({ enabled: true, priority: 4 });
    expect(body.automation.runtime).toMatchObject({ paused: true, pauseReason: "editor review" });
  });

  it("keeps project writing automation modes separate from chat interaction modes and rejects automatic publishing", async () => {
    await writeFile(join(root, "inoks-story-webnovel.json"), "{}\n", "utf-8");
    const app = createStudioServer({} as never, root);
    const updated = await app.request("/api/v1/project/prose-quality", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        automationMode: "auto-draft",
        proseQuality: { enforcement: "balanced" },
        longFormMemory: { sequenceSize: 10 },
      }),
    });

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      automationMode: "auto-draft",
      publicationAutomationEnabled: false,
      proseQuality: { enforcement: "balanced" },
      longFormMemory: { sequenceSize: 10 },
    });

    const loaded = await app.request("/api/v1/project/prose-quality");
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({
      automationMode: "auto-draft",
      publicationAutomationEnabled: false,
      proseQuality: { enforcement: "balanced" },
      longFormMemory: { sequenceSize: 10 },
    });
  });

  it("does not accept automatic external publishing before that capability is enabled", async () => {
    await writeFile(join(root, "inoks-story-webnovel.json"), "{}\n", "utf-8");
    const app = createStudioServer({} as never, root);
    const response = await app.request("/api/v1/project/prose-quality", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ automationMode: "auto-publish" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("not enabled") });
  });

  it("previews and explicitly applies legacy chapter migration under the book lock", async () => {
    const bookDir = join(root, "books", "demo");
    const chapterDir = join(bookDir, "chapters");
    const storyDir = join(bookDir, "story");
    await Promise.all([
      mkdir(chapterDir, { recursive: true }),
      mkdir(storyDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(chapterDir, "0001_开门.md"), "# 第1章 开门\n\n林越推开仓门。\n", "utf-8"),
      writeFile(join(chapterDir, "0002_追踪.md"), "# 第2章 追踪\n\n他沿着车辙追了出去。\n", "utf-8"),
      writeFile(join(storyDir, "current_state.md"), "# 当前状态\n\n- 林越正在追踪铜令。\n", "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# 待处理伏笔\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# 章节摘要\n", "utf-8"),
    ]);
    const app = createStudioServer({} as never, root);

    const before = await app.request("/api/v1/books/demo/story-workbench");
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      storyHead: null,
      storyPreflight: {
        passed: false,
        errors: [expect.stringContaining("legacy-history-unmigrated")],
      },
    });

    const preview = await app.request("/api/v1/books/demo/story-migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: false }),
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      applied: false,
      chapterCount: 2,
      commitIds: [expect.stringMatching(/^commit-/), expect.stringMatching(/^commit-/)],
    });
    expect(await (await app.request("/api/v1/books/demo/story-workbench")).json()).toMatchObject({
      storySystem: {
        latestMigration: {
          applied: false,
          chapterCount: 2,
        },
      },
    });
    await expect(readFile(
      join(bookDir, ".inoks-story-webnovel", "story-system", "HEAD"),
      "utf-8",
    )).rejects.toThrow();

    const unconfirmed = await app.request("/api/v1/books/demo/story-migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true }),
    });
    expect(unconfirmed.status).toBe(400);

    const applied = await app.request("/api/v1/books/demo/story-migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true, confirmBookId: "demo" }),
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({
      applied: true,
      chapterCount: 2,
      backupPath: expect.stringContaining("backups"),
    });

    const after = await app.request("/api/v1/books/demo/story-workbench");
    expect(after.status).toBe(200);
    expect(await after.json()).toMatchObject({
      storyHead: { chapter: 2 },
      storyPreflight: { passed: true, errors: [] },
      storySystem: { acceptedCommitCount: 2 },
    });
  });

  it("requires an explicit transition before an exported chapter is considered published", async () => {
    const bookDir = join(root, "books", "demo");
    const publishingDir = join(bookDir, ".inoks-story-webnovel", "publishing");
    await mkdir(publishingDir, { recursive: true });
    await writeFile(join(publishingDir, "records.json"), JSON.stringify([{
      bookId: "demo",
      chapterNumber: 1,
      chapterVersion: 1,
      chapterCommitId: "commit-1",
      platform: "fanqie",
      deliveryMethod: "fanqie-extension-package",
      exportedTextHash: "a".repeat(64),
      status: "exported",
      updatedAt: "2026-07-29T00:00:00.000Z",
    }]), "utf-8");
    const app = createStudioServer({} as never, root);

    const handed = await app.request("/api/v1/books/demo/story-workbench/publication/1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "fanqie",
        chapterCommitId: "commit-1",
        status: "handed_to_extension",
      }),
    });
    expect(handed.status).toBe(200);
    expect(await handed.json()).toMatchObject({ status: "handed_to_extension" });

    const published = await app.request("/api/v1/books/demo/story-workbench/publication/1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "fanqie",
        chapterCommitId: "commit-1",
        status: "published_external",
      }),
    });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ status: "published_external" });
  });
});

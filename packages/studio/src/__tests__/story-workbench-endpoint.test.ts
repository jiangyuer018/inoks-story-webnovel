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

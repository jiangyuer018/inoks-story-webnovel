import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer } from "../api/server.js";
import { ensureChapterSpec, StorySpecStore } from "@inoks-story-webnovel/core";

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
      quality: { "scene-semantic": unknown[] };
      storyPreflight: { passed: boolean; errors: unknown[] };
    };
    expect(body.constitution).toContain("正史唯一来源");
    expect(body.specs).toEqual([]);
    expect(body.automation.config.enabled).toBe(false);
    expect(body.automation.runtime.paused).toBe(false);
    expect(body.publications).toEqual([]);
    expect(body.quality["scene-semantic"]).toEqual([]);
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
        storySpec: { approvalMode: "automatic" },
      }),
    });

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      automationMode: "auto-draft",
      publicationAutomationEnabled: false,
      proseQuality: { enforcement: "balanced" },
      longFormMemory: { sequenceSize: 10 },
      storySpec: { approvalMode: "automatic", blockOnPlaceholders: true },
    });

    const loaded = await app.request("/api/v1/project/prose-quality");
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({
      automationMode: "auto-draft",
      publicationAutomationEnabled: false,
      proseQuality: { enforcement: "balanced" },
      longFormMemory: { sequenceSize: 10 },
      storySpec: { approvalMode: "automatic", requireReaderContract: true },
    });
  });

  it("persists a complete Reader Contract and exposes readiness for first-chapter planning", async () => {
    const app = createStudioServer({} as never, root);
    const before = await (await app.request("/api/v1/books/demo/story-workbench")).json() as {
      readerContract: { ready: boolean; missingSections: string[]; version: number };
    };
    expect(before.readerContract.ready).toBe(false);
    expect(before.readerContract.missingSections).toContain("coreFantasy");

    const response = await app.request("/api/v1/books/demo/story-workbench/reader-contract", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coreFantasy: ["林舟凭线索和规则撬动封闭城防体系"],
        emotionalPromises: ["每次选择都带来可见代价与反击空间"],
        progressionPromises: ["林舟从被追捕者成长为掌握城防证据链的人"],
        relationshipPromises: ["林舟与赵横在互相试探中不断改变筹码"],
        mysteryPromises: ["死去驿卒留下的内应名单会逐层揭晓"],
        identityPromises: ["林舟与旧城防档案的身份关联会有事实兑现"],
        forbiddenBetrayals: ["不得让关键证据无因失效或让人物越过知识边界"],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: true, missingSections: [], version: 2 });

    const after = await (await app.request("/api/v1/books/demo/story-workbench")).json() as {
      readerContract: { ready: boolean; coreFantasy: string[]; version: number };
    };
    expect(after.readerContract).toMatchObject({
      ready: true,
      coreFantasy: ["林舟凭线索和规则撬动封闭城防体系"],
      version: 2,
    });
  });

  it("shows concrete-planning blockers and approves only the exact reviewed Story Spec version", async () => {
    const bookDir = join(root, "books", "demo");
    const generated = await ensureChapterSpec({
      bookId: "demo",
      bookDir,
      chapterNumber: 1,
      intent: {
        chapter: 1,
        goal: "林舟取得城门通行令",
        mustKeep: [],
        mustAvoid: [],
        styleEmphasis: [],
      },
    });
    const app = createStudioServer({} as never, root);
    const blockedBody = await (await app.request("/api/v1/books/demo/story-workbench")).json() as {
      specs: Array<{ planningValidation: { verdict: string; missingFields: string[] } }>;
    };
    expect(blockedBody.specs[0]?.planningValidation.verdict).toBe("block");
    expect(blockedBody.specs[0]?.planningValidation.missingFields).toContain("location");

    const rejected = await app.request("/api/v1/books/demo/story-workbench/spec/1/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: generated.version }),
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: { code: "STORY_SPEC_APPROVAL_REJECTED" },
    });

    const scene = generated.sceneContracts[0]!;
    const concrete = await new StorySpecStore(bookDir).saveChapter({
      ...generated,
      version: generated.version + 1,
      pov: "林舟",
      location: "北城门验令台",
      time: "宵禁前一刻",
      requiredStateChanges: ["林舟持有守门官登记过的通行令"],
      sceneContracts: [{
        ...scene,
        pov: "林舟",
        oppositionGoal: "守门官赵横要扣下有伪造嫌疑的通行令并拘住林舟",
        characterAgendas: {
          林舟: {
            wants: "在宵禁前让赵横登记并放行",
            fears: "令牌夹层的血迹引来搜查",
            hides: ["通行令来自死去的驿卒"],
            cannotSay: ["驿卒临死前说出的内应姓名"],
            tactic: "先用公文编号迫使赵横按规程验令，再观察他避开哪一栏",
            leverage: ["城防司当日验令簿"],
            exitCondition: "赵横完成登记，或当众撕毁令牌承担越权责任",
          },
          赵横: {
            wants: "找到合法理由扣下林舟和令牌",
            fears: "验令簿上的旧签名暴露自己与驿卒相识",
            hides: ["他认得令牌背面的缺口"],
            cannotSay: ["内应要求他拦截持令者"],
            tactic: "反复追问令牌来源并拖到宵禁落闸",
            leverage: ["城门守军", "宵禁时限"],
            exitCondition: "林舟说漏令牌来源，或围观者迫使他按规程放行",
          },
        },
        conflictMethod: "林舟援引验令规程，赵横用来源追问和宵禁时限拖延，双方争夺验令簿",
        turningPoint: "林舟发现赵横刻意跳过验令簿上驿卒签名所在的一栏",
        decisionPoint: "林舟当众要求赵横读出该栏编号，逼他在放行与暴露之间选择",
        irreversibleChange: "赵横盖章放行，但暗中命守军记下林舟去向",
        entryState: {
          goals: ["林舟必须在宵禁前进城"],
          relationships: ["林舟与赵横互不信任"],
          risks: ["令牌来源暴露"],
          resources: ["未登记的通行令"],
          information: ["林舟不知道赵横与驿卒的关系"],
        },
        exitState: {
          goals: ["林舟进城后追查验令簿签名"],
          relationships: ["赵横把林舟列为追踪目标"],
          risks: ["守军开始尾随林舟"],
          resources: ["已登记的通行令"],
          information: ["林舟确认赵横认识死去的驿卒"],
        },
      }],
    });
    const approved = await app.request("/api/v1/books/demo/story-workbench/spec/1/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: concrete.version }),
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      status: "approved",
      approvedBy: "human",
      version: concrete.version + 1,
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

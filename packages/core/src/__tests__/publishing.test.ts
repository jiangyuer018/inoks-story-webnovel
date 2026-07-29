import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChapterCommitStore,
  buildChapterCommit,
  commitChapterTransaction,
  createDefaultProjectionManager,
  type ChapterCommit,
} from "../story-system/index.js";
import {
  PublicationStore,
  exportPublicationPackage,
  importExternalPublicationLog,
  normalizePublicationTitle,
} from "../publishing/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Publishing Export", () => {
  it("exports only accepted commits and keeps its manifest outside the ZIP", async () => {
    const root = await bookDir();
    const commit = buildCommit(root, 1, "正文");
    await commitChapterTransaction({
      bookDir: root,
      commit,
      chapterDocument: "# 第1章 账本\n\n正文",
    });
    const projections = await createDefaultProjectionManager(root).project(commit);
    expect(projections.filter((item) => item.status === "failed")).toEqual([]);

    const result = await exportPublicationPackage({
      bookId: "book",
      bookDir: root,
      platform: "fanqie",
      format: "zip",
    });
    const zip = await JSZip.loadAsync(await readFile(result.outputPath));
    expect(Object.keys(zip.files)).toEqual(["第001章 账本.md"]);
    expect(await zip.file("第001章 账本.md")?.async("string")).toContain("正文");
    expect(await readFile(result.manifestPath, "utf-8")).toContain(commit.commitId);
    expect((await new PublicationStore(root).list("fanqie"))[0]?.status).toBe("exported");
  });

  it("blocks export after chapter text diverges from the effective commit", async () => {
    const root = await bookDir();
    const commit = buildCommit(root, 1, "正文");
    await commitChapterTransaction({
      bookDir: root,
      commit,
      chapterDocument: "# 第1章 账本\n\n正文",
    });
    await createDefaultProjectionManager(root).project(commit);
    await writeFile(join(root, commit.source.chapterPath), "# 第1章 账本\n\n被篡改", "utf-8");

    await expect(exportPublicationPackage({
      bookId: "book",
      bookDir: root,
      platform: "qidian",
    })).rejects.toThrow(/hash mismatch|history-diverged|differs from accepted commit/);
  });

  it("requires confirmation evidence before published status and imports external logs", async () => {
    const root = await bookDir();
    const store = new PublicationStore(root);
    await store.upsert({
      bookId: "book",
      chapterNumber: 1,
      chapterVersion: 1,
      chapterCommitId: "commit-1",
      platform: "fanqie",
      deliveryMethod: "publication-zip",
      exportedTextHash: "a".repeat(64),
      status: "exported",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
    await expect(store.transition({
      platform: "fanqie",
      chapterNumber: 1,
      chapterCommitId: "commit-1",
      status: "published_external",
    })).rejects.toThrow("explicit confirmation");

    const imported = await importExternalPublicationLog({
      bookDir: root,
      platform: "fanqie",
      log: "第1章 上传成功",
    });
    expect(imported[0]?.status).toBe("published_external");
    expect(imported[0]?.externalLog).toContain("上传成功");
  });

  it("normalizes unsafe cross-platform filenames", () => {
    expect(normalizePublicationTitle("CON")).toBe("未命名章节");
    expect(normalizePublicationTitle('终章: <归来>?*')).toBe("终章 归来");
    expect(normalizePublicationTitle("  北站 / 雨夜  ")).toBe("北站 雨夜");
  });
});

async function bookDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inkos-publishing-"));
  roots.push(root);
  await mkdir(join(root, "chapters"), { recursive: true });
  await mkdir(join(root, "story"), { recursive: true });
  return root;
}

function buildCommit(
  root: string,
  chapter: number,
  content: string,
  parentCommit?: ChapterCommit,
): ChapterCommit {
  return buildChapterCommit({
    bookId: "book",
    bookDir: root,
    chapter,
    title: chapter === 1 ? "账本" : "门外",
    content,
    wordCount: content.length,
    chapterPath: join(root, "chapters", `${String(chapter).padStart(4, "0")}_chapter.md`),
    parentCommit,
    proseQualityPassed: true,
    continuityPassed: true,
    fulfillmentPassed: true,
    blockingCount: 0,
    extendedValidation: {
      storyConvergencePassed: true,
      humanFeelPassed: true,
      emotionPassed: true,
      payoffPassed: true,
      structurePassed: true,
      similarityPassed: true,
      temporalPassed: true,
      humanApprovalPassed: true,
    },
    candidates: { acceptedCandidates: [], ambiguousCandidates: [], rejectedCandidates: [] },
    summary: {
      chapter,
      title: "账本",
      characters: "",
      events: "",
      stateChanges: "",
      hookActivity: "",
      mood: "",
      chapterType: "",
      text: "",
    },
    projectionPayload: {},
  });
}

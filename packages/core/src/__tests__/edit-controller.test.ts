import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChapterMeta } from "../models/chapter.js";
import {
  classifyTruthAuthority,
  normalizeTruthFileName,
} from "../interaction/truth-authority.js";
import {
  executeEditTransaction,
  planEditTransaction,
  type EditRequest,
} from "../interaction/edit-controller.js";

let projectRoot: string;

function createAmendmentApplier(onDocument?: (document: string) => void) {
  return async (bookId: string, chapterNumber: number, chapterDocument: string) => {
    onDocument?.(chapterDocument);
    const chaptersDir = join(projectRoot, "books", bookId, "chapters");
    const prefix = `${String(chapterNumber).padStart(4, "0")}_`;
    const chapterFile = (await readdir(chaptersDir))
      .find((file) => file.startsWith(prefix) && file.endsWith(".md"));
    if (!chapterFile) return { applied: false, skippedReason: "chapter missing" };
    await writeFile(join(chaptersDir, chapterFile), chapterDocument, "utf-8");
    return { applied: true };
  };
}

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "inoks-story-edit-controller-"));
  await mkdir(join(projectRoot, "books", "harbor", "story", "runtime"), { recursive: true });
  await mkdir(join(projectRoot, "books", "harbor", "chapters"), { recursive: true });
});

describe("truth authority", () => {
  it("normalizes supported truth files", () => {
    expect(normalizeTruthFileName("story_bible")).toBe("story_bible.md");
    expect(normalizeTruthFileName("current_state.md")).toBe("current_state.md");
  });

  it("classifies control and truth authority tiers", () => {
    expect(classifyTruthAuthority("author_intent.md")).toBe("direction");
    expect(classifyTruthAuthority("current_focus.md")).toBe("direction");
    expect(classifyTruthAuthority("story_bible.md")).toBe("foundation");
    expect(classifyTruthAuthority("book_rules.md")).toBe("rules");
    expect(classifyTruthAuthority("current_state.md")).toBe("runtime-truth");
  });
});

describe("edit controller", () => {
  it("refuses direct derived-truth edits after ChapterCommit authority is enabled", async () => {
    const bookDir = join(projectRoot, "books", "authority-book");
    const storyDir = join(bookDir, "story");
    const headDir = join(bookDir, ".inoks-story-webnovel", "story-system");
    await mkdir(storyDir, { recursive: true });
    await mkdir(headDir, { recursive: true });
    await writeFile(join(storyDir, "current_state.md"), "canonical projection", "utf-8");
    await writeFile(join(headDir, "HEAD"), "commit-1\n", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "truth-file-edit",
        bookId: "authority-book",
        fileName: "current_state.md",
        instruction: "bypass",
      },
    )).rejects.toThrow("ChapterCommit projection");
    await expect(readFile(join(storyDir, "current_state.md"), "utf-8"))
      .resolves.toBe("canonical projection");
  });

  it("plans entity rename transactions", () => {
    const result = planEditTransaction({
      kind: "entity-rename",
      bookId: "harbor",
      entityType: "protagonist",
      oldValue: "陆尘",
      newValue: "林砚",
    });

    expect(result.transactionType).toBe("entity-rename");
    expect(result.affectedScope).toBe("book");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans chapter rewrite transactions", () => {
    const result = planEditTransaction({
      kind: "chapter-rewrite",
      bookId: "harbor",
      chapterNumber: 3,
      instruction: "Keep the ending reveal.",
    });

    expect(result.transactionType).toBe("chapter-rewrite");
    expect(result.affectedScope).toBe("downstream");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans whole-chapter replacement transactions as chapter-scoped edits", () => {
    const result = planEditTransaction({
      kind: "chapter-replace",
      bookId: "harbor",
      chapterNumber: 3,
      fullText: "# 第3章 新稿\n\n完整替换正文。",
    });

    expect(result.transactionType).toBe("chapter-replace");
    expect(result.affectedScope).toBe("chapter");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans local text edits without forcing full-book rebuild", () => {
    const result = planEditTransaction({
      kind: "chapter-local-edit",
      bookId: "harbor",
      chapterNumber: 5,
      instruction: "Only rewrite the final paragraph.",
    });

    expect(result.transactionType).toBe("chapter-local-edit");
    expect(result.affectedScope).toBe("chapter");
    expect(result.requiresTruthRebuild).toBe(true);
  });

  it("plans truth-file edits with authority metadata", () => {
    const result = planEditTransaction({
      kind: "truth-file-edit",
      bookId: "harbor",
      fileName: "book_rules",
      instruction: "Lock the protagonist name to Lin Yan.",
    });

    expect(result.transactionType).toBe("truth-file-edit");
    expect(result.truthAuthority).toBe("rules");
    expect(result.affectedScope).toBe("book");
  });

  it("plans focus edits as direction-level transactions", () => {
    const result = planEditTransaction({
      kind: "focus-edit",
      bookId: "harbor",
      instruction: "Bring the story back to the old case.",
    });

    expect(result.transactionType).toBe("focus-edit");
    expect(result.truthAuthority).toBe("direction");
    expect(result.affectedScope).toBe("future");
    expect(result.requiresTruthRebuild).toBe(false);
  });

  it("executes entity rename across truth files and chapters", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角陆尘住在港口。", "utf-8");
    await writeFile(join(bookDir, "chapters", "0001_旧名字.md"), "# 第1章 旧名字\n\n陆尘走进港口。", "utf-8");

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("林砚");
    await expect(readFile(join(bookDir, "chapters", "0001_旧名字.md"), "utf-8")).resolves.toContain("林砚");
    expect(result.touchedFiles.length).toBeGreaterThan(0);
  });

  it("does not rewrite trashed chapters during entity rename", async () => {
    const bookDir = join(projectRoot, "books", "trashbook");
    await mkdir(join(bookDir, "story"), { recursive: true });
    await mkdir(join(bookDir, "chapters", ".trash"), { recursive: true });
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角陆尘住在港口。", "utf-8");
    await writeFile(join(bookDir, "chapters", ".trash", "0009_旧章.md"), "陆尘在被删除的章节里。", "utf-8");

    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "trashbook",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("林砚");
    await expect(readFile(join(bookDir, "chapters", ".trash", "0009_旧章.md"), "utf-8")).resolves.toContain("陆尘");
  });

  it("does not rewrite story snapshots during entity rename", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角陆尘住在港口。", "utf-8");
    await mkdir(join(bookDir, "story", "snapshots", "1"), { recursive: true });
    await writeFile(join(bookDir, "story", "snapshots", "1", "current_state.md"), "陆尘在旧快照里。", "utf-8");

    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    );

    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8")).resolves.toContain("林砚");
    await expect(readFile(join(bookDir, "story", "snapshots", "1", "current_state.md"), "utf-8")).resolves.toContain("陆尘");
  });

  it("renames entity files whose filename embeds the old name so path references don't dangle", async () => {
    const bookDir = join(projectRoot, "books", "rolebook");
    await mkdir(join(bookDir, "roles", "主要角色"), { recursive: true });
    await mkdir(join(bookDir, "story"), { recursive: true });
    await writeFile(join(bookDir, "roles", "主要角色", "陈default.md"), "# 陈default\n\n陈default是主角。", "utf-8");
    // A manifest that references the role file by path — the path must follow the rename.
    await writeFile(join(bookDir, "story", "story_bible.md"), "主角档案见 roles/主要角色/陈default.md。", "utf-8");

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "rolebook",
        entityType: "protagonist",
        oldValue: "陈default",
        newValue: "陈烬",
      },
    );

    // The file is renamed on disk and its content updated.
    await expect(readFile(join(bookDir, "roles", "主要角色", "陈烬.md"), "utf-8")).resolves.toContain("陈烬");
    // The old filename is gone — no dangling reference.
    await expect(access(join(bookDir, "roles", "主要角色", "陈default.md")).then(() => true).catch(() => false))
      .resolves.toBe(false);
    // The manifest's path reference now points at the renamed file.
    await expect(readFile(join(bookDir, "story", "story_bible.md"), "utf-8"))
      .resolves.toContain("roles/主要角色/陈烬.md");
    expect(result.touchedFiles).toContain(join("roles", "主要角色", "陈烬.md"));
    expect(result.summary).toContain("renamed on disk");
  });

  it("aborts an entity rename when the target filename already exists, without rewriting content", async () => {
    const bookDir = join(projectRoot, "books", "collisionbook");
    await mkdir(join(bookDir, "roles", "主要角色"), { recursive: true });
    await writeFile(join(bookDir, "roles", "主要角色", "甲.md"), "甲的档案。", "utf-8");
    await writeFile(join(bookDir, "roles", "主要角色", "乙.md"), "乙的档案,提到甲。", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "collisionbook",
        entityType: "character",
        oldValue: "甲",
        newValue: "乙",
      },
    )).rejects.toThrow(/already exists/);

    // The collision is detected before any write — content stays untouched (no partial application).
    await expect(readFile(join(bookDir, "roles", "主要角色", "乙.md"), "utf-8")).resolves.toBe("乙的档案,提到甲。");
  });

  it("rejects a rename target that contains a path separator", async () => {
    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "character",
        oldValue: "陆尘",
        newValue: "../evil",
      },
    )).rejects.toThrow(/path separators/);
  });

  it("executes chapter text patches through the audited amendment path", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0003_灰墙榜下.md"), "# 第3章 灰墙榜下\n\n旧名字在这里。", "utf-8");
    await writeFile(join(bookDir, "story", "runtime", "chapter-0003.intent.md"), "stale", "utf-8");
    const chapterIndex = [{
      number: 3,
      title: "灰墙榜下",
      status: "ready-for-review" as const,
      wordCount: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let savedIndex: ChapterMeta[] = [...chapterIndex];
    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async (_bookId, index) => {
          savedIndex = [...index];
        },
        applyChapterAmendment: createAmendmentApplier(),
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 3,
        instruction: "Replace old text",
        targetText: "旧名字",
        replacementText: "新名字",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0003_灰墙榜下.md"), "utf-8")).resolves.toContain("新名字");
    expect(savedIndex[0]?.status).toBe("ready-for-review");
    expect(savedIndex[0]?.auditIssues).toEqual([]);
    expect(result.reviewRequired).toBe(false);
    expect(result.summary).toContain("audited amendment");
  });

  it("delegates the complete patched document to the amendment pipeline", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0005_对账.md"), "# 第5章 对账\n\n她核对了三遍账目。", "utf-8");
    const chapterIndex = [{
      number: 5,
      title: "对账",
      status: "ready-for-review" as const,
      wordCount: 999,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let amendedDocument = "";
    await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async () => undefined,
        applyChapterAmendment: createAmendmentApplier((document) => {
          amendedDocument = document;
        }),
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 5,
        instruction: "Replace the recount detail",
        targetText: "三遍账目",
        replacementText: "五遍账目，又签了名",
      },
    );

    expect(amendedDocument).toContain("# 第5章 对账");
    expect(amendedDocument).toContain("她核对了五遍账目，又签了名。");
  });

  it("patches chapter text when the target only differs by whitespace", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(
      join(bookDir, "chapters", "0004_雨巷.md"),
      "# 第4章 雨巷\n\n她把账本\n塞进外套里，继续往前走。",
      "utf-8",
    );
    const chapterIndex = [{
      number: 4,
      title: "雨巷",
      status: "ready-for-review" as const,
      wordCount: 18,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async () => undefined,
        applyChapterAmendment: createAmendmentApplier(),
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 4,
        instruction: "Patch wrapped text",
        targetText: "她把账本 塞进外套里",
        replacementText: "她把账本贴着胸口藏好",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0004_雨巷.md"), "utf-8"))
      .resolves.toContain("她把账本贴着胸口藏好，继续往前走。");
    expect(result.reviewRequired).toBe(false);
  });

  it("executes whole-chapter replacement through the audited amendment path", async () => {
    const bookDir = join(projectRoot, "books", "replacebook");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await mkdir(join(bookDir, "story", "runtime"), { recursive: true });
    await writeFile(join(bookDir, "chapters", "0002_旧章.md"), "# 第2章 旧章\n\n旧正文。", "utf-8");
    await writeFile(join(bookDir, "story", "runtime", "chapter-0002.plan.md"), "stale plan", "utf-8");
    const chapterIndex = [{
      number: 2,
      title: "旧章",
      status: "ready-for-review" as const,
      wordCount: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditIssues: [],
      lengthWarnings: [],
    }];

    let savedIndex: ChapterMeta[] = [...chapterIndex];
    const result = await executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => chapterIndex,
        saveChapterIndex: async (_bookId, index) => {
          savedIndex = [...index];
        },
        applyChapterAmendment: createAmendmentApplier(),
      },
      {
        kind: "chapter-replace",
        bookId: "replacebook",
        chapterNumber: 2,
        fullText: "# 第2章 新章\n\n新正文完整替换。",
      },
    );

    await expect(readFile(join(bookDir, "chapters", "0002_旧章.md"), "utf-8")).resolves.toContain("新正文完整替换");
    await expect(access(join(bookDir, "story", "runtime", "chapter-0002.plan.md")).then(() => true).catch(() => false))
      .resolves.toBe(false);
    expect(savedIndex[0]?.status).toBe("ready-for-review");
    expect(savedIndex[0]?.wordCount).toBe(3);
    expect(savedIndex[0]?.auditIssues).toEqual([]);
    expect(result.reviewRequired).toBe(false);
    expect(result.summary).toContain("audited amendment");
  });

  it("refuses chapter edits when the audited amendment path is unavailable", async () => {
    const bookDir = join(projectRoot, "books", "harbor");
    await writeFile(join(bookDir, "chapters", "0006_拒绝旁路.md"), "# 第6章 拒绝旁路\n\n旧正文。", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: (bookId) => join(projectRoot, "books", bookId),
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "chapter-local-edit",
        bookId: "harbor",
        chapterNumber: 6,
        instruction: "bypass",
        targetText: "旧正文",
        replacementText: "新正文",
      },
    )).rejects.toThrow(/audited ChapterAmendment pipeline/);

    await expect(readFile(join(bookDir, "chapters", "0006_拒绝旁路.md"), "utf-8"))
      .resolves.toContain("旧正文");
  });

  it("does not swallow unexpected filesystem errors while collecting editable files", async () => {
    const invalidRoot = join(projectRoot, "invalid-root.txt");
    await writeFile(invalidRoot, "not a directory", "utf-8");

    await expect(executeEditTransaction(
      {
        bookDir: () => invalidRoot,
        loadChapterIndex: async () => [],
        saveChapterIndex: async () => undefined,
      },
      {
        kind: "entity-rename",
        bookId: "harbor",
        entityType: "protagonist",
        oldValue: "陆尘",
        newValue: "林砚",
      },
    )).rejects.toThrow(/not a directory|ENOTDIR/i);
  });
});

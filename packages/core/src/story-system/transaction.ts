import { copyFile, open, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ChapterCommit } from "./types.js";
import { ChapterCommitStore, sha256, validateChapterCommit } from "./commit.js";

export type ChapterTransactionPhase =
  | "prepared"
  | "chapter_moved"
  | "commit_moved"
  | "committed"
  | "projecting"
  | "complete";

interface TransactionManifest {
  readonly transactionId: string;
  readonly phase: ChapterTransactionPhase;
  readonly chapter: number;
  readonly chapterPath: string;
  readonly commitPath: string;
  readonly eventPath: string;
  readonly sourcePath: string;
  readonly stagedChapterPath: string;
  readonly stagedCommitPath: string;
  readonly stagedEventPath: string;
  readonly stagedSourcePath: string;
  readonly previousChapterBackupPath?: string;
  readonly hadPreviousChapter?: boolean;
  readonly previousHeadCommitId?: string | null;
  readonly contentHash: string;
  readonly commitId: string;
  readonly createdAt: string;
}

export async function commitChapterTransaction(params: {
  readonly bookDir: string;
  readonly commit: ChapterCommit;
  readonly chapterDocument: string;
}): Promise<{
  readonly idempotent: boolean;
  readonly manifestPath: string;
  readonly commitPath: string;
  readonly chapterPath: string;
}> {
  const store = new ChapterCommitStore(params.bookDir);
  const existing = await store.loadChapter(params.commit.chapter);
  const isAmendment = typeof params.commit.provenance.amendsCommitId === "string";
  if (existing) {
    if (existing.commitId === params.commit.commitId && existing.source.contentHash === params.commit.source.contentHash) {
      return {
        idempotent: true,
        manifestPath: "",
        commitPath: store.commitPathFor(params.commit),
        chapterPath: join(params.bookDir, params.commit.source.chapterPath),
      };
    }
    if (!isAmendment) {
      throw new Error(`Chapter ${params.commit.chapter} already has a different accepted commit`);
    }
    if (params.commit.provenance.amendsCommitId !== existing.commitId) {
      throw new Error(
        `Amendment target conflict: expected effective commit ${existing.commitId}, got ${String(params.commit.provenance.amendsCommitId)}`,
      );
    }
  }

  const head = await store.loadHead();
  const currentValues = await buildCanonicalCurrentValues(store);
  validateChapterCommit({
    commit: params.commit,
    content: stripHeading(params.chapterDocument),
    head,
    currentValues,
  });

  const transactionId = params.commit.commitId;
  const transactionDir = join(store.root, "transactions", transactionId);
  const stagedChapterPath = join(transactionDir, "chapter.md");
  const stagedCommitPath = join(transactionDir, "commit.json");
  const stagedEventPath = join(transactionDir, "events.json");
  const stagedSourcePath = join(transactionDir, "source.md");
  const previousChapterBackupPath = join(transactionDir, "previous-chapter.md");
  const manifestPath = join(transactionDir, "manifest.json");
  const chapterPath = join(params.bookDir, params.commit.source.chapterPath);
  const commitPath = store.commitPathFor(params.commit);
  const eventPath = store.eventPathFor(params.commit);
  const sourcePath = store.sourcePath(params.commit.commitId);
  await mkdir(transactionDir, { recursive: true });
  await mkdir(dirname(chapterPath), { recursive: true });
  await mkdir(dirname(commitPath), { recursive: true });
  await mkdir(dirname(eventPath), { recursive: true });
  await mkdir(dirname(sourcePath), { recursive: true });
  const hadPreviousChapter = await exists(chapterPath);
  if (hadPreviousChapter) {
    await copyFile(chapterPath, previousChapterBackupPath);
    await fsyncFile(previousChapterBackupPath);
  }
  await writeFile(stagedChapterPath, params.chapterDocument, "utf-8");
  await writeFile(stagedCommitPath, `${JSON.stringify(params.commit, null, 2)}\n`, "utf-8");
  await writeFile(stagedEventPath, `${JSON.stringify(params.commit.events, null, 2)}\n`, "utf-8");
  await writeFile(stagedSourcePath, params.chapterDocument, "utf-8");
  await fsyncFile(stagedChapterPath);
  await fsyncFile(stagedCommitPath);
  await fsyncFile(stagedEventPath);
  await fsyncFile(stagedSourcePath);
  if (sha256(stripHeading(await readFile(stagedChapterPath, "utf-8"))) !== params.commit.source.contentHash) {
    throw new Error("Staged chapter hash mismatch");
  }
  let manifest: TransactionManifest = {
    transactionId,
    phase: "prepared",
    chapter: params.commit.chapter,
    chapterPath,
    commitPath,
    eventPath,
    sourcePath,
    stagedChapterPath,
    stagedCommitPath,
    stagedEventPath,
    stagedSourcePath,
    previousChapterBackupPath,
    hadPreviousChapter,
    previousHeadCommitId: head?.commitId ?? null,
    contentHash: params.commit.source.contentHash,
    commitId: params.commit.commitId,
    createdAt: new Date().toISOString(),
  };
  await writeManifest(manifestPath, manifest);
  await renameWithRetry(stagedChapterPath, chapterPath);
  manifest = { ...manifest, phase: "chapter_moved" };
  await writeManifest(manifestPath, manifest);
  await renameWithRetry(stagedCommitPath, commitPath);
  await renameWithRetry(stagedEventPath, eventPath);
  await renameWithRetry(stagedSourcePath, sourcePath);
  manifest = { ...manifest, phase: "commit_moved" };
  await writeManifest(manifestPath, manifest);
  await writeHeadAtomic(store.root, params.commit.commitId);
  await removeSupersededChapterFiles(chapterPath, params.commit.chapter);
  manifest = { ...manifest, phase: "committed" };
  await writeManifest(manifestPath, manifest);
  return { idempotent: false, manifestPath, commitPath, chapterPath };
}

export async function markTransactionPhase(
  manifestPath: string,
  phase: ChapterTransactionPhase,
): Promise<void> {
  if (!manifestPath) return;
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as TransactionManifest;
  await writeManifest(manifestPath, { ...manifest, phase });
}

export async function completeProjectionTransactions(
  bookDir: string,
  commitIds?: ReadonlySet<string>,
): Promise<ReadonlyArray<string>> {
  const store = new ChapterCommitStore(bookDir);
  const transactionsDir = join(store.root, "transactions");
  const names = await import("node:fs/promises")
    .then(({ readdir }) => readdir(transactionsDir).catch(() => [] as string[]));
  const completed: string[] = [];
  for (const name of names) {
    const manifestPath = join(transactionsDir, name, "manifest.json");
    const raw = await readFile(manifestPath, "utf-8").catch(() => "");
    if (!raw) continue;
    const manifest = JSON.parse(raw) as TransactionManifest;
    if (manifest.phase === "complete") continue;
    if (commitIds && !commitIds.has(manifest.commitId)) continue;
    if (manifest.phase !== "committed" && manifest.phase !== "projecting") continue;
    if (!await exists(manifest.commitPath) || !await exists(manifest.chapterPath)) continue;
    await writeManifest(manifestPath, { ...manifest, phase: "complete" });
    completed.push(manifest.commitId);
  }
  return completed;
}

export async function recoverChapterTransactions(bookDir: string): Promise<ReadonlyArray<string>> {
  const store = new ChapterCommitStore(bookDir);
  const transactionsDir = join(store.root, "transactions");
  const names = await import("node:fs/promises").then(({ readdir }) => readdir(transactionsDir).catch(() => [] as string[]));
  const recovered: string[] = [];
  for (const name of names) {
    const manifestPath = join(transactionsDir, name, "manifest.json");
    const raw = await readFile(manifestPath, "utf-8").catch(() => "");
    if (!raw) continue;
    const manifest = JSON.parse(raw) as TransactionManifest;
    if (manifest.phase === "complete") continue;
    const chapterExists = await exists(manifest.chapterPath);
    const commitExists = await exists(manifest.commitPath);
    const eventExists = await exists(manifest.eventPath);
    const sourceExists = await exists(manifest.sourcePath);
    if (!chapterExists && await exists(manifest.stagedChapterPath)) {
      await mkdir(dirname(manifest.chapterPath), { recursive: true });
      await renameWithRetry(manifest.stagedChapterPath, manifest.chapterPath);
    }
    if (!commitExists && await exists(manifest.stagedCommitPath)) {
      await mkdir(dirname(manifest.commitPath), { recursive: true });
      await renameWithRetry(manifest.stagedCommitPath, manifest.commitPath);
    }
    if (!eventExists && await exists(manifest.stagedEventPath)) {
      await mkdir(dirname(manifest.eventPath), { recursive: true });
      await renameWithRetry(manifest.stagedEventPath, manifest.eventPath);
    }
    if (!sourceExists && await exists(manifest.stagedSourcePath)) {
      await mkdir(dirname(manifest.sourcePath), { recursive: true });
      await renameWithRetry(manifest.stagedSourcePath, manifest.sourcePath);
    }
    if (await exists(manifest.chapterPath)
      && await exists(manifest.commitPath)
      && await exists(manifest.eventPath)
      && await exists(manifest.sourcePath)) {
      const commit = JSON.parse(await readFile(manifest.commitPath, "utf-8")) as ChapterCommit;
      if (sha256(stripHeading(await readFile(manifest.chapterPath, "utf-8"))) !== commit.source.contentHash) {
        throw new Error(`Transaction ${manifest.transactionId} chapter hash mismatch`);
      }
      await removeSupersededChapterFiles(manifest.chapterPath, manifest.chapter);
      await writeManifest(manifestPath, { ...manifest, phase: "committed" });
      recovered.push(manifest.transactionId);
      continue;
    }
    await rollbackIncompleteTransaction(store.root, manifest);
    await rm(join(transactionsDir, name), { recursive: true, force: true });
  }
  if (recovered.length > 0) {
    const tail = (await store.listCommits()).filter((commit) => commit.status === "accepted").at(-1);
    if (tail) await writeHeadAtomic(store.root, tail.commitId);
  }
  return recovered;
}

async function rollbackIncompleteTransaction(
  storySystemRoot: string,
  manifest: TransactionManifest,
): Promise<void> {
  const headPath = join(storySystemRoot, "HEAD");
  const currentHead = (await readFile(headPath, "utf-8").catch(() => "")).trim();
  if (currentHead === manifest.commitId) {
    if (manifest.previousHeadCommitId) {
      await writeHeadAtomic(storySystemRoot, manifest.previousHeadCommitId);
    } else {
      await rm(headPath, { force: true });
    }
  }

  if (await exists(manifest.chapterPath)) {
    if (manifest.hadPreviousChapter === undefined) {
      throw new Error(
        `Transaction ${manifest.transactionId} predates safe chapter rollback metadata; manual repair is required`,
      );
    }
    if (manifest.hadPreviousChapter) {
      if (!manifest.previousChapterBackupPath || !await exists(manifest.previousChapterBackupPath)) {
        throw new Error(
          `Transaction ${manifest.transactionId} cannot restore the previous chapter safely`,
        );
      }
      await renameWithRetry(manifest.previousChapterBackupPath, manifest.chapterPath);
    } else {
      const bodyHash = sha256(stripHeading(await readFile(manifest.chapterPath, "utf-8")));
      if (bodyHash !== manifest.contentHash) {
        throw new Error(
          `Transaction ${manifest.transactionId} chapter changed after the crash; refusing automatic rollback`,
        );
      }
      await rm(manifest.chapterPath, { force: true });
    }
  }

  await removeOwnedCommitFile(manifest.commitPath, manifest.commitId);
  await Promise.all([
    rm(manifest.eventPath, { force: true }),
    rm(manifest.sourcePath, { force: true }),
  ]);
}

async function removeOwnedCommitFile(path: string, commitId: string): Promise<void> {
  const raw = await readFile(path, "utf-8").catch(() => "");
  if (!raw) return;
  const parsed = JSON.parse(raw) as { commitId?: unknown };
  if (parsed.commitId !== commitId) {
    throw new Error(`Refusing to remove commit file not owned by transaction ${commitId}`);
  }
  await rm(path, { force: true });
}

function stripHeading(value: string): string {
  return value.replace(/^# .*\r?\n+/, "");
}

async function writeManifest(path: string, manifest: TransactionManifest): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  await renameWithRetry(temp, path);
}

async function writeHeadAtomic(storySystemRoot: string, commitId: string): Promise<void> {
  const path = join(storySystemRoot, "HEAD");
  const temp = join(storySystemRoot, `HEAD.${process.pid}.tmp`);
  await mkdir(storySystemRoot, { recursive: true });
  await writeFile(temp, `${commitId}\n`, "utf-8");
  await fsyncFile(temp);
  await renameWithRetry(temp, path);
}

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    try {
      await handle.sync();
    } catch (error) {
      // Windows/OneDrive can reject fsync even for a writable handle. The
      // staged hash verification and atomic rename still provide a recoverable
      // transaction boundary; other fsync errors remain fatal.
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally {
    await handle.close();
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EACCES") throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function buildCanonicalCurrentValues(
  store: ChapterCommitStore,
): Promise<ReadonlyMap<string, unknown>> {
  const values = new Map<string, unknown>();
  for (const commit of await store.listCommits()) {
    if (commit.status !== "accepted") continue;
    for (const delta of commit.stateDeltas) {
      values.set(`${delta.subject}::${delta.predicate}`, delta.newValue);
    }
  }
  return values;
}

async function removeSupersededChapterFiles(
  authoritativePath: string,
  chapter: number,
): Promise<void> {
  const chapterDir = dirname(authoritativePath);
  const authoritativeName = basename(authoritativePath);
  const prefix = `${String(chapter).padStart(4, "0")}_`;
  const names = await import("node:fs/promises")
    .then(({ readdir }) => readdir(chapterDir).catch(() => [] as string[]));
  for (const name of names) {
    if (name === authoritativeName || !name.startsWith(prefix) || !name.endsWith(".md")) continue;
    await rm(join(chapterDir, name), { force: true });
  }
}

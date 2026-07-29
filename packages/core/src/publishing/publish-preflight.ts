import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ChapterCommitStore, sha256 } from "../story-system/commit.js";
import type { ChapterCommit } from "../story-system/types.js";
import { runStorySystemPreflight } from "../story-system/preflight.js";
import { PublicationStore } from "./publication-store.js";
import type { PublicationPlatform } from "./types.js";

export interface PublishableChapter {
  readonly commit: ChapterCommit;
  readonly chapterVersion: number;
  readonly body: string;
}

export async function runPublishPreflight(params: {
  readonly bookDir: string;
  readonly platform: PublicationPlatform;
  readonly fromChapter?: number;
  readonly toChapter?: number;
}): Promise<ReadonlyArray<PublishableChapter>> {
  const preflight = await runStorySystemPreflight({
    bookDir: params.bookDir,
    strict: true,
    blockOnProjectionFailure: true,
  });
  if (!preflight.passed) {
    throw new Error(`Publication blocked by Story System preflight: ${preflight.errors.join("; ")}`);
  }

  const commits = (await new ChapterCommitStore(params.bookDir).listCommits())
    .filter((commit) => commit.status === "accepted");
  const latest = new Map<number, ChapterCommit>();
  const versions = new Map<number, number>();
  for (const commit of commits) {
    latest.set(commit.chapter, commit);
    versions.set(commit.chapter, (versions.get(commit.chapter) ?? 0) + 1);
  }
  const selected = [...latest.values()]
    .filter((commit) =>
      commit.chapter >= (params.fromChapter ?? 1)
      && commit.chapter <= (params.toChapter ?? Number.MAX_SAFE_INTEGER))
    .sort((left, right) => left.chapter - right.chapter);
  if (selected.length === 0) throw new Error("No accepted ChapterCommit is available for publication");
  assertContiguous(selected);

  const records = await new PublicationStore(params.bookDir).list(params.platform);
  const firstChapter = selected[0]!.chapter;
  const previousFailure = records.find((record) =>
    record.chapterNumber < firstChapter && record.status === "failed_external");
  if (previousFailure) {
    throw new Error(`Publication blocked: chapter ${previousFailure.chapterNumber} previously failed externally`);
  }

  return Promise.all(selected.map(async (commit) => {
    const raw = await readFile(join(params.bookDir, commit.source.chapterPath), "utf-8");
    const body = raw.replace(/^# .*\r?\n+/, "");
    if (sha256(body) !== commit.source.contentHash) {
      throw new Error(`Publication blocked: chapter ${commit.chapter} differs from accepted commit`);
    }
    return {
      commit,
      chapterVersion: versions.get(commit.chapter) ?? 1,
      body,
    };
  }));
}

function assertContiguous(commits: ReadonlyArray<ChapterCommit>): void {
  for (let index = 1; index < commits.length; index++) {
    if (commits[index]!.chapter !== commits[index - 1]!.chapter + 1) {
      throw new Error(`Publication chapter conflict between ${commits[index - 1]!.chapter} and ${commits[index]!.chapter}`);
    }
  }
}

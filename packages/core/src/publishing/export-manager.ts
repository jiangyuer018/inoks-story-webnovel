import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { canonicalJson, sha256 } from "../story-system/commit.js";
import { FanqieExtensionExporter } from "./adapters/fanqie-extension-exporter.js";
import { QidianExporter } from "./adapters/qidian-exporter.js";
import { PublicationStore, writeJsonAtomic } from "./publication-store.js";
import { runPublishPreflight } from "./publish-preflight.js";
import type {
  PublicationExportResult,
  PublicationManifest,
  PublicationPlatform,
} from "./types.js";

export async function exportPublicationPackage(params: {
  readonly bookId: string;
  readonly bookDir: string;
  readonly platform: PublicationPlatform;
  readonly format?: "md" | "txt" | "zip";
  readonly chapterFileFormat?: "md" | "txt";
  readonly fromChapter?: number;
  readonly toChapter?: number;
  readonly outputPath?: string;
}): Promise<PublicationExportResult> {
  const format = params.format ?? "zip";
  const chapterFileFormat = format === "zip" ? (params.chapterFileFormat ?? "md") : format;
  const chapters = await runPublishPreflight(params);
  const adapter = params.platform === "fanqie"
    ? new FanqieExtensionExporter()
    : new QidianExporter();
  const files = chapters.map((chapter) => ({
    ...adapter.render({
      chapterNumber: chapter.commit.chapter,
      title: chapter.commit.source.title,
      body: chapter.body,
      extension: chapterFileFormat,
    }),
    chapter,
  }));
  const batchId = `publish-${sha256(canonicalJson({
    bookId: params.bookId,
    platform: params.platform,
    format,
    commits: chapters.map((chapter) => chapter.commit.commitId),
  })).slice(0, 24)}`;
  const defaultOutput = join(
    params.bookDir,
    "publication-exports",
    params.platform,
    format === "zip" ? `${batchId}.zip` : batchId,
  );
  const outputPath = params.outputPath ?? defaultOutput;

  if (format === "zip") {
    const zip = new JSZip();
    for (const file of files) zip.file(file.fileName, file.content);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  } else {
    await mkdir(outputPath, { recursive: true });
    await Promise.all(files.map((file) => writeFile(join(outputPath, file.fileName), file.content, "utf-8")));
  }

  const store = new PublicationStore(params.bookDir);
  const manifest: PublicationManifest = {
    schemaVersion: "1.0",
    batchId,
    bookId: params.bookId,
    platform: params.platform,
    format,
    chapterFileFormat,
    entries: files.map((file) => ({
      chapterNumber: file.chapter.commit.chapter,
      chapterVersion: file.chapter.chapterVersion,
      commitId: file.chapter.commit.commitId,
      contentHash: file.chapter.commit.source.contentHash,
      exportedTextHash: sha256(file.content),
      fileName: file.fileName,
    })),
    createdAt: new Date().toISOString(),
  };
  const manifestPath = store.batchManifestPath(batchId);
  await writeJsonAtomic(manifestPath, manifest);
  for (const file of files) {
    await store.upsert({
      bookId: params.bookId,
      chapterNumber: file.chapter.commit.chapter,
      chapterVersion: file.chapter.chapterVersion,
      chapterCommitId: file.chapter.commit.commitId,
      platform: params.platform,
      deliveryMethod: format === "zip" ? "publication-zip" : "publication-folder",
      exportBatchId: batchId,
      exportedFileName: file.fileName,
      exportedTextHash: sha256(file.content),
      status: "exported",
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    batchId,
    platform: params.platform,
    outputPath,
    manifestPath,
    chaptersExported: files.length,
    files: files.map((file) => file.fileName),
  };
}

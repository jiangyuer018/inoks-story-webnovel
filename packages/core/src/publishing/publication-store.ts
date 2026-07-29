import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ExternalPublicationRecordSchema,
  type ExternalPublicationRecord,
  type PublicationPlatform,
  type PublicationStatus,
} from "./types.js";

export class PublicationStore {
  readonly root: string;

  constructor(bookDir: string) {
    this.root = join(bookDir, ".inoks-story-webnovel", "publishing");
  }

  async list(platform?: PublicationPlatform): Promise<ReadonlyArray<ExternalPublicationRecord>> {
    const raw = await readFile(join(this.root, "records.json"), "utf-8").catch(() => "");
    const records = raw
      ? ExternalPublicationRecordSchema.array().parse(JSON.parse(raw))
      : [];
    return platform ? records.filter((record) => record.platform === platform) : records;
  }

  async upsert(record: ExternalPublicationRecord): Promise<ExternalPublicationRecord> {
    const parsed = ExternalPublicationRecordSchema.parse(record);
    const records = await this.list();
    const key = publicationKey(parsed);
    const next = [
      ...records.filter((item) => publicationKey(item) !== key),
      parsed,
    ].sort((left, right) =>
      left.platform.localeCompare(right.platform)
      || left.chapterNumber - right.chapterNumber
      || left.chapterVersion - right.chapterVersion);
    await writeJsonAtomic(join(this.root, "records.json"), next);
    return parsed;
  }

  async transition(params: {
    readonly platform: PublicationPlatform;
    readonly chapterNumber: number;
    readonly chapterCommitId: string;
    readonly status: PublicationStatus;
    readonly externalLog?: string;
    readonly scheduledAt?: string;
    readonly publishedAt?: string;
  }): Promise<ExternalPublicationRecord> {
    const current = (await this.list(params.platform)).find((record) =>
      record.chapterNumber === params.chapterNumber
      && record.chapterCommitId === params.chapterCommitId);
    if (!current) throw new Error(`Publication record not found for chapter ${params.chapterNumber}`);
    if (params.status === "published_external" && !params.externalLog && !params.publishedAt) {
      throw new Error("Published status requires explicit confirmation or an external log");
    }
    return this.upsert({
      ...current,
      status: params.status,
      externalLog: params.externalLog ?? current.externalLog,
      scheduledAt: params.scheduledAt ?? current.scheduledAt,
      publishedAt: params.publishedAt
        ?? (params.status === "published_external" ? new Date().toISOString() : current.publishedAt),
      updatedAt: new Date().toISOString(),
    });
  }

  batchManifestPath(batchId: string): string {
    if (!/^publish-[a-f0-9]{24}$/.test(batchId)) throw new Error(`Unsafe publication batch id: ${batchId}`);
    return join(this.root, "batches", `${batchId}.manifest.json`);
  }
}

function publicationKey(record: ExternalPublicationRecord): string {
  return `${record.platform}\0${record.chapterNumber}\0${record.chapterCommitId}`;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

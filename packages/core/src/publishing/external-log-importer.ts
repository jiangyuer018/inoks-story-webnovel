import { PublicationStore } from "./publication-store.js";
import type {
  ExternalPublicationRecord,
  PublicationPlatform,
  PublicationStatus,
} from "./types.js";

export async function importExternalPublicationLog(params: {
  readonly bookDir: string;
  readonly platform: PublicationPlatform;
  readonly log: string;
}): Promise<ReadonlyArray<ExternalPublicationRecord>> {
  const updates = parseLog(params.log);
  const store = new PublicationStore(params.bookDir);
  const current = await store.list(params.platform);
  const results: ExternalPublicationRecord[] = [];
  for (const update of updates) {
    const record = current
      .filter((item) => item.chapterNumber === update.chapterNumber)
      .sort((left, right) => right.chapterVersion - left.chapterVersion)[0];
    if (!record) continue;
    results.push(await store.transition({
      platform: params.platform,
      chapterNumber: record.chapterNumber,
      chapterCommitId: record.chapterCommitId,
      status: update.status,
      externalLog: update.raw,
      ...(update.status === "published_external" ? { publishedAt: new Date().toISOString() } : {}),
    }));
  }
  return results;
}

function parseLog(log: string): ReadonlyArray<{
  readonly chapterNumber: number;
  readonly status: PublicationStatus;
  readonly raw: string;
}> {
  try {
    const json = JSON.parse(log) as unknown;
    if (Array.isArray(json)) {
      return json.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const value = entry as Record<string, unknown>;
        const chapterNumber = Number(value.chapterNumber ?? value.chapter);
        const status = normalizeStatus(String(value.status ?? ""));
        return Number.isInteger(chapterNumber) && chapterNumber > 0 && status
          ? [{ chapterNumber, status, raw: JSON.stringify(entry) }]
          : [];
      });
    }
  } catch {
    // The extension also exports human-readable logs; parse those below.
  }
  return log.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/(?:第\s*)?(\d+)\s*章?/);
    const status = normalizeStatus(line);
    return match?.[1] && status
      ? [{ chapterNumber: Number(match[1]), status, raw: line }]
      : [];
  });
}

function normalizeStatus(value: string): PublicationStatus | null {
  if (/published_external|发布成功|上传成功|已发布/i.test(value)) return "published_external";
  if (/failed_external|失败|错误/i.test(value)) return "failed_external";
  if (/scheduled_external|已排期|定时/i.test(value)) return "scheduled_external";
  if (/handed_to_extension|已导入|已交给/i.test(value)) return "handed_to_extension";
  return null;
}

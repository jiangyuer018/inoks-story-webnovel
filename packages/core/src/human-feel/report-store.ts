import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { HumanFeelReport } from "./types.js";

export async function saveHumanFeelReport(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly report: HumanFeelReport;
}): Promise<string> {
  const path = join(
    params.bookDir,
    "quality",
    "human-feel",
    `chapter-${String(params.chapterNumber).padStart(4, "0")}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(params.report, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
  return relative(params.bookDir, path).replaceAll("\\", "/");
}

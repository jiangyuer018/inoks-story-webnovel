import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyzeBenchmarkSimilarity } from "./similarity-guard.js";
import type {
  AbstractNarrativeMechanism,
  BenchmarkProfile,
  SimilarityReport,
} from "./types.js";

export class BenchmarkStore {
  readonly root: string;

  constructor(bookDir: string) {
    this.root = join(bookDir, ".inoks-story-webnovel", "benchmark");
  }

  async saveProfile(profile: BenchmarkProfile, sourceText: string): Promise<void> {
    const dir = this.sourceDir(profile.sourceId);
    await writeJsonAtomic(join(dir, "profile.json"), profile);
    await writeAtomic(join(dir, "source-text.txt"), sourceText);
  }

  async loadProfile(sourceId: string): Promise<BenchmarkProfile | null> {
    const raw = await readFile(join(this.sourceDir(sourceId), "profile.json"), "utf-8").catch(() => "");
    return raw ? JSON.parse(raw) as BenchmarkProfile : null;
  }

  async listProfiles(): Promise<ReadonlyArray<BenchmarkProfile>> {
    const names = await readdir(join(this.root, "sources")).catch(() => []);
    const profiles = await Promise.all(names.map((name) => this.loadProfile(name)));
    return profiles.filter((profile): profile is BenchmarkProfile => Boolean(profile));
  }

  async approvedMechanisms(): Promise<ReadonlyArray<AbstractNarrativeMechanism>> {
    return (await this.listProfiles()).flatMap((profile) =>
      profile.extractedMechanisms.filter((mechanism) => mechanism.approved));
  }

  async setMechanismApproval(
    sourceId: string,
    mechanismId: string,
    approved: boolean,
  ): Promise<BenchmarkProfile> {
    const profile = await this.loadProfile(sourceId);
    if (!profile) throw new Error(`Benchmark source ${sourceId} not found`);
    if (!profile.extractedMechanisms.some((mechanism) => mechanism.id === mechanismId)) {
      throw new Error(`Mechanism ${mechanismId} not found in ${sourceId}`);
    }
    const next: BenchmarkProfile = {
      ...profile,
      extractedMechanisms: profile.extractedMechanisms.map((mechanism) =>
        mechanism.id === mechanismId ? { ...mechanism, approved } : mechanism),
    };
    const text = await this.loadSourceText(sourceId);
    await this.saveProfile(next, text);
    return next;
  }

  async analyzeSimilarity(candidate: string): Promise<SimilarityReport> {
    const profiles = await this.listProfiles();
    const sources = await Promise.all(profiles.map(async (profile) => ({
      sourceId: profile.sourceId,
      text: await this.loadSourceText(profile.sourceId),
    })));
    return analyzeBenchmarkSimilarity({ candidate, sources });
  }

  async saveSimilarityReport(
    chapter: number,
    report: SimilarityReport,
  ): Promise<string> {
    const path = join(this.root, "similarity", `chapter-${String(chapter).padStart(4, "0")}.json`);
    await writeJsonAtomic(path, {
      ...report,
      chapter,
      createdAt: new Date().toISOString(),
    });
    return path;
  }

  private async loadSourceText(sourceId: string): Promise<string> {
    return readFile(join(this.sourceDir(sourceId), "source-text.txt"), "utf-8");
  }

  private sourceDir(sourceId: string): string {
    if (!/^[\p{L}\p{N}._-]+$/u.test(sourceId)) throw new Error(`Unsafe benchmark source id: ${sourceId}`);
    return join(this.root, "sources", sourceId);
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf-8");
  await rename(temporary, path);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

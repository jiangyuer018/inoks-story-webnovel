import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyzeBenchmarkSimilarity } from "./similarity-guard.js";
import type {
  AbstractNarrativeMechanism,
  BenchmarkProfile,
  BenchmarkStructureSignature,
  NarrativeDeliveryProfile,
  SimilarityReport,
  StructuredSimilarityInput,
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
    return raw ? normalizeProfile(JSON.parse(raw) as BenchmarkProfile) : null;
  }

  async listProfiles(): Promise<ReadonlyArray<BenchmarkProfile>> {
    const names = await readdir(join(this.root, "sources")).catch(() => []);
    const profiles = await Promise.all(names.map((name) => this.loadProfile(name)));
    return profiles.filter((profile): profile is BenchmarkProfile => Boolean(profile));
  }

  async approvedMechanisms(): Promise<ReadonlyArray<AbstractNarrativeMechanism>> {
    return (await this.listProfiles()).flatMap((profile) =>
      profile.extractedMechanisms
        .filter((mechanism) => mechanism.approved)
        .map((mechanism) => ({
          ...mechanism,
          // Source-specific names and phrases remain in the isolated profile for
          // post-write comparison. They are never exposed to Writer context.
          prohibitedSourceDetails: [],
          sourceReferences: mechanism.sourceReferences.map((reference) => ({
            sourceId: `source-${reference.evidenceHash.slice(0, 12)}`,
            ...(reference.chapterNumber !== undefined ? { chapterNumber: reference.chapterNumber } : {}),
            ...(reference.sceneIndex !== undefined ? { sceneIndex: reference.sceneIndex } : {}),
            evidenceHash: reference.evidenceHash,
          })),
        })));
  }

  async approvedDeliveryProfiles(): Promise<ReadonlyArray<NarrativeDeliveryProfile>> {
    return (await this.listProfiles())
      .filter((profile) => profile.extractedMechanisms.some((mechanism) => mechanism.approved))
      .map((profile) => profile.deliveryProfile);
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

  async analyzeSimilarity(candidate: string | StructuredSimilarityInput): Promise<SimilarityReport> {
    const profiles = await this.listProfiles();
    const sources = await Promise.all(profiles.map(async (profile) => ({
      sourceId: profile.sourceId,
      text: await this.loadSourceText(profile.sourceId),
    })));
    const structured = typeof candidate === "string"
      ? {
          text: candidate,
          eventSequence: [],
          entities: [],
          relationships: [],
          sceneFunctions: [],
          beatSequence: [],
        }
      : candidate;
    return analyzeBenchmarkSimilarity({
      candidate: structured.text,
      sources,
      candidateEvents: structured.eventSequence,
      candidateEntities: structured.entities,
      candidateRelationships: structured.relationships,
      candidateSceneFunctions: structured.sceneFunctions,
      candidateBeats: structured.beatSequence,
      sourceSignatures: Object.fromEntries(
        profiles.map((profile) => [profile.sourceId, profile.structureSignature]),
      ),
    });
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

const EMPTY_DELIVERY_PROFILE: NarrativeDeliveryProfile = {
  dialogueInformationRatio: 0,
  actionInformationRatio: 0,
  objectInformationRatio: 0,
  narrationInformationRatio: 0,
  averageInteractionTurns: 0,
  reactionCouplingScore: 0,
  thoughtToDecisionRate: 0,
  functionalEnvironmentRate: 0,
  explanatoryNarrationRate: 0,
  commonDialogueTactics: [],
  commonOmissionStrategies: [],
  commonSceneEntryMethods: [],
  commonSceneExitMethods: [],
};

function normalizeProfile(profile: BenchmarkProfile): BenchmarkProfile {
  const legacy = profile as BenchmarkProfile & {
    readonly deliveryProfile?: NarrativeDeliveryProfile;
    readonly structureSignature?: BenchmarkStructureSignature;
  };
  return {
    ...profile,
    deliveryProfile: legacy.deliveryProfile ?? EMPTY_DELIVERY_PROFILE,
    structureSignature: legacy.structureSignature ?? {
      eventSequence: profile.chapterProfiles.flatMap((chapter) => chapter.plannedOrInferredFunctions),
      entities: profile.prohibitedSourceElements ?? [],
      relationships: [],
      sceneFunctions: profile.chapterProfiles.flatMap((chapter) => chapter.beats.map((beat) => beat.function)),
      beatSequence: profile.chapterProfiles.flatMap((chapter) =>
        chapter.beats.map((beat) => `${beat.function}:${beat.pressureChange}`)),
    },
  };
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

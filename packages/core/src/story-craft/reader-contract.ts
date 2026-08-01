import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const ContractListSchema = z.array(z.string().trim().min(1)).default([]);

export const ReaderContractContentSchema = z.object({
  coreFantasy: ContractListSchema,
  emotionalPromises: ContractListSchema,
  progressionPromises: ContractListSchema,
  relationshipPromises: ContractListSchema,
  mysteryPromises: ContractListSchema,
  identityPromises: ContractListSchema,
  forbiddenBetrayals: ContractListSchema,
});

export const ReaderContractSchema = ReaderContractContentSchema.extend({
  version: z.number().int().min(1),
  updatedAt: z.string().datetime(),
});

export interface ReaderContract {
  readonly coreFantasy: ReadonlyArray<string>;
  readonly emotionalPromises: ReadonlyArray<string>;
  readonly progressionPromises: ReadonlyArray<string>;
  readonly relationshipPromises: ReadonlyArray<string>;
  readonly mysteryPromises: ReadonlyArray<string>;
  readonly identityPromises: ReadonlyArray<string>;
  readonly forbiddenBetrayals: ReadonlyArray<string>;
  readonly version: number;
  readonly updatedAt: string;
}

export class ReaderContractStore {
  readonly path: string;

  constructor(bookDir: string) {
    this.path = join(bookDir, ".inoks-story-webnovel", "story-craft", "reader-contract.json");
  }

  async load(): Promise<ReaderContract | null> {
    const raw = await readFile(this.path, "utf-8").catch(() => "");
    return raw ? ReaderContractSchema.parse(JSON.parse(raw)) : null;
  }

  async ensure(seed: {
    readonly coreFantasy?: ReadonlyArray<string>;
    readonly forbiddenBetrayals?: ReadonlyArray<string>;
  } = {}): Promise<ReaderContract> {
    const current = await this.load();
    if (current) return current;
    const contract: ReaderContract = {
      coreFantasy: [...(seed.coreFantasy ?? [])],
      emotionalPromises: [],
      progressionPromises: [],
      relationshipPromises: [],
      mysteryPromises: [],
      identityPromises: [],
      forbiddenBetrayals: [...(seed.forbiddenBetrayals ?? [])],
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.path, contract);
    return contract;
  }

  async save(next: Omit<ReaderContract, "version" | "updatedAt">): Promise<ReaderContract> {
    const current = await this.load();
    const contract = ReaderContractSchema.parse({
      ...ReaderContractContentSchema.parse(next),
      version: (current?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    });
    await writeJsonAtomic(this.path, contract);
    return contract;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

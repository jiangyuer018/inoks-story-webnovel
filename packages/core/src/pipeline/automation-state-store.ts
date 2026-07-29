import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const AutomationRuntimeStateSchema = z.object({
  schemaVersion: z.literal("1.0").default("1.0"),
  paused: z.boolean().default(false),
  pauseReason: z.string().optional(),
  editing: z.boolean().default(false),
  lastWrittenAt: z.string().datetime().optional(),
  dailyDate: z.string().optional(),
  dailyCount: z.number().int().min(0).default(0),
  consecutiveFailures: z.number().int().min(0).default(0),
  failureDimensions: z.record(z.string(), z.number().int().min(0)).default({}),
  lastError: z.string().optional(),
  updatedAt: z.string().datetime(),
});

export type AutomationRuntimeState = z.infer<typeof AutomationRuntimeStateSchema>;

export class AutomationStateStore {
  constructor(private readonly bookDir: string) {}

  async load(now = new Date()): Promise<AutomationRuntimeState> {
    const raw = await readFile(this.path, "utf-8").catch(() => "");
    const parsed = raw
      ? AutomationRuntimeStateSchema.parse(JSON.parse(raw))
      : this.initial(now);
    const today = now.toISOString().slice(0, 10);
    return parsed.dailyDate === today
      ? parsed
      : { ...parsed, dailyDate: today, dailyCount: 0 };
  }

  async update(
    patch: Partial<Omit<AutomationRuntimeState, "schemaVersion" | "updatedAt">>,
    now = new Date(),
  ): Promise<AutomationRuntimeState> {
    const current = await this.load(now);
    const next = AutomationRuntimeStateSchema.parse({
      ...current,
      ...patch,
      updatedAt: now.toISOString(),
    });
    await writeJsonAtomic(this.path, next);
    return next;
  }

  private initial(now: Date): AutomationRuntimeState {
    return AutomationRuntimeStateSchema.parse({
      dailyDate: now.toISOString().slice(0, 10),
      updatedAt: now.toISOString(),
    });
  }

  private get path(): string {
    return join(this.bookDir, ".inoks-story-webnovel", "automation-state.json");
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temporary, path);
}

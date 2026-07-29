import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type HumanFeelIssueDecision = "accepted" | "rejected";

export interface HumanFeelReviewState {
  readonly issueDecisions: Readonly<Record<string, HumanFeelIssueDecision>>;
  readonly lockedParagraphs: ReadonlyArray<number>;
  readonly updatedAt: string;
}

export class HumanFeelDecisionStore {
  constructor(
    private readonly bookDir: string,
    private readonly chapter: number,
  ) {}

  async load(): Promise<HumanFeelReviewState> {
    const raw = await readFile(this.path, "utf-8").catch(() => "");
    if (!raw) return { issueDecisions: {}, lockedParagraphs: [], updatedAt: new Date(0).toISOString() };
    const value = JSON.parse(raw) as Partial<HumanFeelReviewState>;
    return {
      issueDecisions: value.issueDecisions ?? {},
      lockedParagraphs: [...new Set(value.lockedParagraphs ?? [])].filter((item) => Number.isInteger(item) && item >= 0),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    };
  }

  async decide(issueId: string, decision: HumanFeelIssueDecision): Promise<HumanFeelReviewState> {
    if (!issueId.trim()) throw new Error("Human Feel issue id is required");
    const current = await this.load();
    return this.save({
      ...current,
      issueDecisions: { ...current.issueDecisions, [issueId]: decision },
    });
  }

  async setParagraphLock(paragraph: number, locked: boolean): Promise<HumanFeelReviewState> {
    if (!Number.isInteger(paragraph) || paragraph < 0) throw new Error("Paragraph index must be a non-negative integer");
    const current = await this.load();
    const values = new Set(current.lockedParagraphs);
    if (locked) values.add(paragraph);
    else values.delete(paragraph);
    return this.save({ ...current, lockedParagraphs: [...values].sort((a, b) => a - b) });
  }

  private async save(value: Omit<HumanFeelReviewState, "updatedAt">): Promise<HumanFeelReviewState> {
    const next = { ...value, updatedAt: new Date().toISOString() };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    await rename(temporary, this.path);
    return next;
  }

  private get path(): string {
    return join(
      this.bookDir,
      "quality",
      "human-feel",
      `chapter-${String(this.chapter).padStart(4, "0")}.decisions.json`,
    );
  }
}

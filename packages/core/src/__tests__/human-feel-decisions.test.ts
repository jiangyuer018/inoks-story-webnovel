import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { HumanFeelDecisionStore } from "../human-feel/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("HumanFeelDecisionStore", () => {
  it("persists issue decisions and paragraph locks without changing reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-human-decisions-"));
    roots.push(root);
    const store = new HumanFeelDecisionStore(root, 3);
    await store.decide("issue-1", "accepted");
    await store.setParagraphLock(4, true);
    const reloaded = await new HumanFeelDecisionStore(root, 3).load();
    expect(reloaded.issueDecisions).toEqual({ "issue-1": "accepted" });
    expect(reloaded.lockedParagraphs).toEqual([4]);
    await store.setParagraphLock(4, false);
    expect((await store.load()).lockedParagraphs).toEqual([]);
  });
});

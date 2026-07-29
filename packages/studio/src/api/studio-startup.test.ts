import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareStudioProjectRoot } from "./server.js";

describe("Studio standalone startup", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("initializes a missing project config before loading Studio", async () => {
    const root = await mkdtemp(join(tmpdir(), "inoks-story-studio-startup-"));
    roots.push(root);

    const config = await prepareStudioProjectRoot(root);

    expect(config.name).toMatch(/^inoks-story-studio-startup-/);
    expect(config.llm.configSource).toBe("studio");
    expect(config.llm.service).toBe("custom");
    await expect(readFile(join(root, "inoks-story-webnovel.json"), "utf-8"))
      .resolves.toContain("\"configSource\": \"studio\"");
  });
});

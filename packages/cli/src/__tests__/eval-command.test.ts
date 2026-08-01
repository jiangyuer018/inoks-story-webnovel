import { describe, expect, it } from "vitest";
import { evalCommand } from "../commands/eval.js";

describe("eval command", () => {
  it("exposes the fail-closed 30-case scene blind-review aggregator", () => {
    const command = evalCommand.commands.find((item) => item.name() === "scene-blind");
    expect(command).toBeDefined();
    expect(command?.description()).toContain("30-case A/B/C human scene blind review");
    expect(command?.options.some((option) => option.long === "--input" && option.required)).toBe(true);
  });
});

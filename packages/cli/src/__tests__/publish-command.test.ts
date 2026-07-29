import { describe, expect, it } from "vitest";
import { publishCommand } from "../commands/publish.js";

describe("publish command", () => {
  it("registers export, status, mark, and import-log", () => {
    expect(publishCommand.commands.map((command) => command.name())).toEqual([
      "export",
      "status",
      "mark",
      "import-log",
    ]);
  });
});

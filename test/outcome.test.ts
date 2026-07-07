import { describe, it, expect } from "vitest";
import { formatOutcome } from "../src/outcome.js";

describe("formatOutcome", () => {
  it("summarises files + short commit when the run wrote something", () => {
    expect(formatOutcome({ runId: "r", text: "x", commit: "abcdef1234567", filesTouched: ["notes/x.md", "notes/y.md"] }))
      .toBe("✓ saved to notes/x.md, notes/y.md · commit abcdef1");
  });
  it("caps the file list at three and counts the rest", () => {
    expect(formatOutcome({ runId: "r", text: "x", commit: "abcdef1234567", filesTouched: ["a", "b", "c", "d", "e"] }))
      .toBe("✓ saved to a, b, c +2 more · commit abcdef1");
  });
  it("returns empty string when nothing was committed (a read-only answer stands alone)", () => {
    expect(formatOutcome({ runId: "r", text: "x", commit: null, filesTouched: [] })).toBe("");
  });
});

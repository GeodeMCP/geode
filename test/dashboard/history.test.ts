import { describe, it, expect } from "vitest";
import { buildHistoryPreamble } from "../../src/dashboard/history.js";

const rec = (instruction: string, text: string) => ({ runId: "r", ts: 0, instruction, events: [], result: { text } });

describe("buildHistoryPreamble", () => {
  it("returns empty for no records", () => { expect(buildHistoryPreamble([], 6)).toBe(""); });
  it("keeps only the last N turns and labels them", () => {
    const recs = [rec("first", "a"), rec("second", "b"), rec("third", "c")];
    const out = buildHistoryPreamble(recs, 2);
    expect(out).toContain("Recent conversation");
    expect(out).not.toContain("first");
    expect(out).toContain("You: second");
    expect(out).toContain("Vault: c");
  });
});

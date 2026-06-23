// web/src/timeline.test.ts
import { expect, test } from "vitest";
import { buildFromHistory } from "./timeline";

test("rebuilds a successful run into user → activity(done step) → agent(meta)", () => {
  const items = buildFromHistory([{
    runId: "r1", ts: 1000, instruction: "do X",
    events: [
      { type: "tool", toolId: "t1", name: "Write", summary: "note.md", detail: "x" },
      { type: "tool_result", toolId: "t1", ok: true, output: "ok" },
    ],
    result: { text: "done", metrics: { durationMs: 1200, costUsd: 0.01, tokens: 50 } },
  }]);
  expect(items.map((i) => i.kind)).toEqual(["user", "activity", "agent"]);
  const activity = items[1] as any;
  expect(activity.steps[0]).toMatchObject({ name: "Write", running: false, ok: true });
  expect((items[2] as any).meta.tokens).toBe(50);
});

test("rebuilds a failed run into user → …events… → error", () => {
  const items = buildFromHistory([{
    runId: "r2", ts: 2000, instruction: "do Y",
    events: [{ type: "thinking", text: "hmm" }],
    error: "boom",
  }]);
  expect(items.map((i) => i.kind)).toEqual(["user", "thinking", "error"]);
  expect((items[2] as any).text).toBe("boom");
});

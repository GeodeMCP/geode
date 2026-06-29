import { describe, it, expect } from "vitest";
import { runCaller, type ModelTurn } from "../../evals/caller.js";

describe("runCaller", () => {
  it("executes tool calls, feeds results back, and records the trace", async () => {
    const turns: ModelTurn[] = [
      { text: "", toolCalls: [{ id: "1", name: "search", input: { query: "deploy" } }] },
      { text: "done", toolCalls: [] },
    ];
    let i = 0;
    const res = await runCaller({
      tools: [{ name: "search", description: "", input_schema: { type: "object" } }],
      model: async () => turns[i++],
      callTool: async (name, input) => `result for ${name} ${JSON.stringify(input)}`,
      system: "sys", prompt: "deploy staging", maxTurns: 5,
    });
    expect(res.trace).toHaveLength(1);
    expect(res.trace[0].name).toBe("search");
    expect(res.trace[0].result).toContain("result for search");
    expect(res.finalText).toBe("done");
    expect(res.turns).toBe(2);
  });

  it("stops at maxTurns even if the model keeps calling tools", async () => {
    const res = await runCaller({
      tools: [{ name: "x", description: "", input_schema: { type: "object" } }],
      model: async () => ({ text: "", toolCalls: [{ id: "1", name: "x", input: {} }] }),
      callTool: async () => "r",
      system: "s", prompt: "p", maxTurns: 3,
    });
    expect(res.trace.length).toBe(3);
    expect(res.turns).toBe(3);
  });
});

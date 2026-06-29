import { describe, it, expect } from "vitest";
import { scoreLeg, aggregate } from "../../evals/scorer.js";
import type { Trace } from "../../evals/types.js";

const call = (name: string, args: Record<string, unknown>, result = ""): Trace[number] => ({ name, args, result });

describe("scoreLeg", () => {
  it("credits discovery + retrieval when the right content reaches the caller", () => {
    const trace: Trace = [call("search", { query: "deploy staging" }, "sops/deploy-staging.md: fly deploy -a acme-staging")];
    const m = scoreLeg(trace, { discovers: true, readsFile: "deploy-staging" }, "should-use", 2);
    expect(m.discovered).toBe(true);
    expect(m.correctRetrieval).toBe(true);
    expect(m.falseTrigger).toBe(null);
  });

  it("credits a correct invoke incl. the right connection", () => {
    const trace: Trace = [call("invoke", { tool: "gmail", action: "send", connection: "companyB" }, "{\"status\":200}")];
    const m = scoreLeg(trace, { invokes: { tool: "gmail", action: "send", connection: "companyB" } }, "should-use", 2);
    expect(m.correctInvoke).toBe(true);
  });

  it("rejects an invoke with the wrong connection", () => {
    const trace: Trace = [call("invoke", { tool: "gmail", action: "send", connection: "private" }, "")];
    const m = scoreLeg(trace, { invokes: { tool: "gmail", action: "send", connection: "companyB" } }, "should-use", 2);
    expect(m.correctInvoke).toBe(false);
  });

  it("flags a false trigger on a negative scenario", () => {
    const trace: Trace = [call("list_capabilities", {}, "...")];
    const m = scoreLeg(trace, {}, "should-not-use", 1);
    expect(m.falseTrigger).toBe(true);
  });

  it("no false trigger when the caller stays quiet on a negative", () => {
    const m = scoreLeg([], {}, "should-not-use", 1);
    expect(m.falseTrigger).toBe(false);
  });

  it("counts heavy query calls", () => {
    const trace: Trace = [call("query", { instruction: "x" }, "answer")];
    const m = scoreLeg(trace, { discovers: true }, "should-use", 2);
    expect(m.heavyQueryCalls).toBe(1);
    expect(m.discovered).toBe(true);
  });

  it("does NOT credit retrieval from a non-content tool result (e.g. list_capabilities)", () => {
    const trace: Trace = [call("list_capabilities", {}, "tone-of-voice.md — Company Z writing voice")];
    const m = scoreLeg(trace, { readsFile: "tone" }, "should-use", 2);
    expect(m.correctRetrieval).toBe(false);
  });

  it("counts going straight to invoke as discovery", () => {
    const trace: Trace = [call("invoke", { tool: "linear", action: "create_issue" }, "{\"status\":200}")];
    const m = scoreLeg(trace, { discovers: true, invokes: { tool: "linear", action: "create_issue" } }, "should-use", 2);
    expect(m.discovered).toBe(true);
  });

  it("reports turns and sums tool-result chars", () => {
    const trace: Trace = [call("search", { query: "x" }, "abcde"), call("read", { path: "y" }, "fghij")];
    const m = scoreLeg(trace, { discovers: true }, "should-use", 3);
    expect(m.turns).toBe(3);
    expect(m.toolResultChars).toBe(10);
  });
});

describe("aggregate", () => {
  it("reduces booleans to rates per metric", () => {
    const rows: LegMetricsRow[] = [
      { config: "A", tier: "weak", m: { discovered: true, correctRetrieval: true, correctInvoke: null, falseTrigger: null, remembered: null, heavyQueryCalls: 0, turns: 2, toolResultChars: 10 } },
      { config: "A", tier: "weak", m: { discovered: false, correctRetrieval: false, correctInvoke: null, falseTrigger: null, remembered: null, heavyQueryCalls: 1, turns: 2, toolResultChars: 10 } },
    ];
    const out = aggregate(rows);
    const a = out.find((r) => r.config === "A" && r.tier === "weak")!;
    expect(a.discovered).toBeCloseTo(0.5);
    expect(a.avgHeavyQueryCalls).toBeCloseTo(0.5);
  });
});

type LegMetricsRow = import("../../evals/scorer.js").LegMetricsRow;

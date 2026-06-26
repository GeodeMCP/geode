import { describe, it, expect } from "vitest";
import { scoreLeg, aggregate } from "../../evals/scorer.js";
import type { Trace } from "../../evals/types.js";

const call = (name: string, args: Record<string, unknown>, result = ""): Trace[number] => ({ name, args, result });

describe("scoreLeg", () => {
  it("credits discovery + retrieval when the right content reaches the caller", () => {
    const trace: Trace = [call("search", { query: "deploy staging" }, "sops/deploy-staging.md: fly deploy -a acme-staging")];
    const m = scoreLeg(trace, { discovers: true, readsFile: "deploy-staging" }, "should-use");
    expect(m.discovered).toBe(true);
    expect(m.correctRetrieval).toBe(true);
    expect(m.falseTrigger).toBe(null);
  });

  it("credits a correct invoke incl. the right connection", () => {
    const trace: Trace = [call("invoke", { tool: "gmail", action: "send", connection: "companyB" }, "{\"status\":200}")];
    const m = scoreLeg(trace, { invokes: { tool: "gmail", action: "send", connection: "companyB" } }, "should-use");
    expect(m.correctInvoke).toBe(true);
  });

  it("rejects an invoke with the wrong connection", () => {
    const trace: Trace = [call("invoke", { tool: "gmail", action: "send", connection: "private" }, "")];
    const m = scoreLeg(trace, { invokes: { tool: "gmail", action: "send", connection: "companyB" } }, "should-use");
    expect(m.correctInvoke).toBe(false);
  });

  it("flags a false trigger on a negative scenario", () => {
    const trace: Trace = [call("list_capabilities", {}, "...")];
    const m = scoreLeg(trace, {}, "should-not-use");
    expect(m.falseTrigger).toBe(true);
  });

  it("no false trigger when the caller stays quiet on a negative", () => {
    const m = scoreLeg([], {}, "should-not-use");
    expect(m.falseTrigger).toBe(false);
  });

  it("counts heavy query calls", () => {
    const trace: Trace = [call("query", { instruction: "x" }, "answer")];
    const m = scoreLeg(trace, { discovers: true }, "should-use");
    expect(m.heavyQueryCalls).toBe(1);
    expect(m.discovered).toBe(true);
  });
});

describe("aggregate", () => {
  it("reduces booleans to rates per metric", () => {
    const rows: LegMetricsRow[] = [
      { config: "A", tier: "weak", m: { discovered: true, correctRetrieval: true, correctInvoke: null, falseTrigger: null, remembered: null, heavyQueryCalls: 0 } },
      { config: "A", tier: "weak", m: { discovered: false, correctRetrieval: false, correctInvoke: null, falseTrigger: null, remembered: null, heavyQueryCalls: 1 } },
    ];
    const out = aggregate(rows);
    const a = out.find((r) => r.config === "A" && r.tier === "weak")!;
    expect(a.discovered).toBeCloseTo(0.5);
    expect(a.avgHeavyQueryCalls).toBeCloseTo(0.5);
  });
});

type LegMetricsRow = import("../../evals/scorer.js").LegMetricsRow;

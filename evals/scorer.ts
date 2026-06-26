import type { Trace, Expect, ScenarioClass, LegMetrics } from "./types.js";

const READ_TOOLS = new Set(["list_capabilities", "search", "read", "query"]);
const CONTENT_TOOLS = new Set(["search", "read", "query"]);
const arg = (c: Trace[number], k: string): unknown => c.args[k];

/** Scores one caller leg against its expectations, returning per-metric booleans (null = N/A). */
export function scoreLeg(trace: Trace, expect: Expect, cls: ScenarioClass): LegMetrics {
  const calledAnyVault = trace.some((c) => READ_TOOLS.has(c.name) || c.name === "invoke" || c.name === "remember");
  const reachedContent = (needle: string) =>
    trace.some((c) => CONTENT_TOOLS.has(c.name) && c.result.toLowerCase().includes(needle.toLowerCase()));
  const heavyQueryCalls = trace.filter((c) => c.name === "query").length;

  const discovered = expect.discovers ? calledAnyVault : null;
  const correctRetrieval = expect.readsFile ? reachedContent(expect.readsFile) : null;

  let correctInvoke: boolean | null = null;
  if (expect.invokes) {
    const want = expect.invokes;
    correctInvoke = trace.some((c) => {
      if (c.name !== "invoke") return false;
      const tool = arg(c, "tool") as string | undefined;
      if (tool !== want.tool || (arg(c, "action") as string) !== want.action) return false;
      return want.connection === undefined || (arg(c, "connection") as string) === want.connection;
    });
  }

  const remembered = expect.remembers ? trace.some((c) => c.name === "remember") : null;
  const falseTrigger = cls === "should-not-use" ? calledAnyVault : null;

  return { discovered, correctRetrieval, correctInvoke, falseTrigger, remembered, heavyQueryCalls };
}

/** One scored leg tagged with the config + caller tier it came from. */
export interface LegMetricsRow { config: string; tier: string; m: LegMetrics }
/** Aggregated rates for one (config, tier) pair. */
export interface ConfigScore {
  config: string; tier: string;
  discovered: number; correctRetrieval: number; correctInvoke: number;
  falseTrigger: number; remembered: number; avgHeavyQueryCalls: number; n: number;
}

const rate = (vals: (boolean | null)[]): number => {
  const present = vals.filter((v): v is boolean => v !== null);
  return present.length ? present.filter(Boolean).length / present.length : 0;
};

/** Reduces per-leg metrics into per-(config,tier) rates. */
export function aggregate(rows: LegMetricsRow[]): ConfigScore[] {
  const groups = new Map<string, LegMetricsRow[]>();
  for (const r of rows) {
    const k = `${r.config} ${r.tier}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return [...groups.values()].map((g) => ({
    config: g[0].config,
    tier: g[0].tier,
    discovered: rate(g.map((r) => r.m.discovered)),
    correctRetrieval: rate(g.map((r) => r.m.correctRetrieval)),
    correctInvoke: rate(g.map((r) => r.m.correctInvoke)),
    falseTrigger: rate(g.map((r) => r.m.falseTrigger)),
    remembered: rate(g.map((r) => r.m.remembered)),
    avgHeavyQueryCalls: g.reduce((s, r) => s + r.m.heavyQueryCalls, 0) / g.length,
    n: g.length,
  }));
}

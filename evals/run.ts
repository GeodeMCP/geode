import Anthropic from "@anthropic-ai/sdk";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CONFIGS } from "./configs.js";
import { SCENARIOS } from "./scenarios.js";
import { buildEvalServer } from "./server.js";
import { connectInMemory, mcpCallTool, anthropicModel } from "./adapters.js";
import { runCaller } from "./caller.js";
import { scoreLeg, aggregate, type LegMetricsRow } from "./scorer.js";
import type { EvalConfig, Scenario } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "vault");
const RESULTS = join(HERE, "results");

const TIERS: Record<string, string> = {
  strong: process.env.GEODE_EVAL_STRONG ?? "claude-sonnet-4-6",
  weak: process.env.GEODE_EVAL_WEAK ?? "claude-haiku-4-5-20251001",
};
const REPEATS = Number(process.env.GEODE_EVAL_REPEATS ?? 2);
const ONLY_TIERS = (process.env.GEODE_EVAL_TIERS ?? "strong,weak").split(",");
const ONLY_CONFIGS = process.env.GEODE_EVAL_CONFIGS?.split(",");

/** Runs one scenario (all legs) for one config+tier over a fresh vault copy; returns scored legs. */
async function runScenario(anthropic: Anthropic, config: EvalConfig, tierModel: string, sc: Scenario): Promise<LegMetricsRow[]> {
  const root = mkdtempSync(join(tmpdir(), "geode-eval-"));
  try {
    cpSync(FIXTURE, root, { recursive: true });
    const server = buildEvalServer(config, root);
    const { client, tools, instructions } = await connectInMemory(server);
    const model = (anthropic as any)._dry
      ? async () => ({ text: "ok", toolCalls: [{ id: "1", name: config.tools[0], input: config.tools[0] === "search" ? { query: "deploy" } : {} }] })
      : anthropicModel(anthropic, tierModel);
    const callTool = mcpCallTool(client);
    const rows: LegMetricsRow[] = [];
    for (const leg of sc.legs) {
      const system = `You are a helpful AI assistant.${instructions ? "\n\n" + instructions : ""}`;
      const { trace } = await runCaller({ tools, model, callTool, system, prompt: leg.prompt, maxTurns: 6 });
      rows.push({ config: config.name, tier: Object.keys(TIERS).find((k) => TIERS[k] === tierModel)!, m: scoreLeg(trace, leg.expect, sc.cls) });
    }
    await client.close();
    return rows;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Runs the full matrix, prints a scorecard, writes JSON. */
async function main(): Promise<void> {
  const anthropic = new Anthropic();
  if (process.env.GEODE_EVAL_DRY) {
    // Offline determinism check: replace the model with one that always lists then stops.
    (anthropic as any)._dry = true;
  }
  const configs = CONFIGS.filter((c) => !ONLY_CONFIGS || ONLY_CONFIGS.includes(c.name));
  const rows: LegMetricsRow[] = [];
  for (const tierName of ONLY_TIERS) {
    const model = TIERS[tierName];
    for (const config of configs) {
      for (const sc of SCENARIOS) {
        for (let r = 0; r < REPEATS; r++) {
          process.stderr.write(`· ${tierName}/${config.name}/${sc.id} #${r + 1}\n`);
          rows.push(...(await runScenario(anthropic, config, model, sc)));
        }
      }
    }
  }
  const scores = aggregate(rows);
  const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
  console.log("\nconfig                tier    disc  retr  invk  false rem   qry/leg  n");
  for (const s of scores.sort((a, b) => a.config.localeCompare(b.config) || a.tier.localeCompare(b.tier))) {
    console.log(`${s.config.padEnd(20)} ${s.tier.padEnd(6)} ${pct(s.discovered)} ${pct(s.correctRetrieval)} ${pct(s.correctInvoke)} ${pct(s.falseTrigger)} ${pct(s.remembered)}  ${s.avgHeavyQueryCalls.toFixed(1)}      ${s.n}`);
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, "latest.json"), JSON.stringify({ at: new Date().toISOString(), scores, rows }, null, 2));
  console.log(`\nWrote ${join(RESULTS, "latest.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

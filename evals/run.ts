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

/**
 * Runs one scenario (all legs) for one config+tier over a fresh vault copy.
 * Returns scored legs; legs that fail with an infrastructure error are skipped
 * (not pushed) and appended to the `failures` array as "<config>/<scenario>".
 *
 * @param anthropic - Anthropic client (may have _dry flag set)
 * @param config    - Eval configuration
 * @param tierName  - Tier key (e.g. "strong" or "weak")
 * @param sc        - Scenario to run
 * @param failures  - Mutable array; failed leg labels are pushed here
 */
async function runScenario(
  anthropic: Anthropic,
  config: EvalConfig,
  tierName: string,
  sc: Scenario,
  failures: string[],
): Promise<LegMetricsRow[]> {
  const tierModel = TIERS[tierName];
  const root = mkdtempSync(join(tmpdir(), "geode-eval-"));
  try {
    cpSync(FIXTURE, root, { recursive: true });
    const server = buildEvalServer(config, root);
    const { client, tools, instructions } = await connectInMemory(server);
    const model = (anthropic as any)._dry
      ? async ({ messages }: { messages: unknown[] }) =>
          messages.length === 1
            ? { text: "ok", toolCalls: [{ id: "1", name: config.tools[0], input: config.tools[0] === "search" ? { query: "deploy" } : {} }] }
            : { text: "ok", toolCalls: [] }
      : anthropicModel(anthropic, tierModel);
    const callTool = mcpCallTool(client);
    const rows: LegMetricsRow[] = [];
    for (const leg of sc.legs) {
      const label = `${config.name}/${sc.id}`;
      try {
        const system = `You are a helpful AI assistant.${instructions ? "\n\n" + instructions : ""}`;
        const { trace, turns } = await runCaller({ tools, model, callTool, system, prompt: leg.prompt, maxTurns: 6 });
        rows.push({ config: config.name, tier: tierName, m: scoreLeg(trace, leg.expect, sc.cls, turns) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  ✗ ${label} failed: ${msg}\n`);
        failures.push(label);
      }
    }
    await client.close();
    return rows;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Aggregates rows, prints the scorecard, and writes results/latest.json. */
function saveAndPrint(rows: LegMetricsRow[], failures: string[]): void {
  const scores = aggregate(rows);
  const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
  console.log("\nconfig                tier    disc  retr  invk  false rem   qry/leg turns  chars  n");
  for (const s of scores.sort((a, b) => a.config.localeCompare(b.config) || a.tier.localeCompare(b.tier))) {
    console.log(`${s.config.padEnd(20)} ${s.tier.padEnd(6)} ${pct(s.discovered)} ${pct(s.correctRetrieval)} ${pct(s.correctInvoke)} ${pct(s.falseTrigger)} ${pct(s.remembered)}  ${s.avgHeavyQueryCalls.toFixed(1)}   ${s.avgTurns.toFixed(1)}  ${Math.round(s.avgToolResultChars).toString().padStart(5)}  ${s.n}`);
  }
  console.log(`\nFailed legs: ${failures.length}`);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    join(RESULTS, "latest.json"),
    JSON.stringify({ at: new Date().toISOString(), scores, rows, failures }, null, 2),
  );
  console.log(`\nWrote ${join(RESULTS, "latest.json")}`);
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
  const failures: string[] = [];
  try {
    for (const tierName of ONLY_TIERS) {
      if (!TIERS[tierName]) continue;
      for (const config of configs) {
        for (const sc of SCENARIOS) {
          for (let r = 0; r < REPEATS; r++) {
            process.stderr.write(`· ${tierName}/${config.name}/${sc.id} #${r + 1}\n`);
            const legRows = await runScenario(anthropic, config, tierName, sc, failures);
            rows.push(...legRows);
            // Incremental save after each scenario so a later crash leaves partial results.
            mkdirSync(RESULTS, { recursive: true });
            writeFileSync(
              join(RESULTS, "latest.json"),
              JSON.stringify({ at: new Date().toISOString(), scores: aggregate(rows), rows, failures }, null, 2),
            );
          }
        }
      }
    }
  } finally {
    saveAndPrint(rows, failures);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

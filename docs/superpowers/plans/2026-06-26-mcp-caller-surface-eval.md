# MCP caller-surface eval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rerunnable harness that measures, on the tool-call trace, how well different MCP tool-surfaces (tools + descriptions + server instructions) let an arbitrary caller agent discover and use the Geode vault — across a strong and a weak/local model tier.

**Architecture:** A self-contained `evals/` harness. It defines *candidate* tools (search/read/tiered list_capabilities) and deterministic stub handlers over a throwaway fixture-vault copy — it does NOT couple to production `query()`/git internals, because we score the *caller's decisions*, not server execution. The only real model is the caller, driven by an injectable tool-use loop wired to an in-memory MCP client (`InMemoryTransport`) and the Anthropic Messages API. Pure pieces (scorer, capabilities rendering, caller loop) are unit-tested in vitest; the full matrix runs via `npm run eval`.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` (McpServer + Client + InMemoryTransport), `@anthropic-ai/sdk` (caller model), `vitest` (pure-unit tests), `tsx` (run script).

**Spec:** `docs/superpowers/specs/2026-06-26-mcp-caller-surface-eval-design.md`

**Note on commits:** the user holds commits on `main`. Each task ends with a `git commit` step; if working on `main`, create a branch first (`git checkout -b feat/caller-surface-eval`) before the first commit. Exported symbols get JSDoc (the husky precommit gate blocks undocumented exports).

---

## File structure

| File | Responsibility |
|---|---|
| `evals/types.ts` | Shared types: `ToolManifest`, `EvalConfig`, `Scenario`, `Trace`, `LegMetrics`, … |
| `evals/scorer.ts` | Pure scoring: `scoreLeg(trace, expect, cls)` + `aggregate(rows)` |
| `evals/capabilities.ts` | `loadManifests(root)`, `renderCapabilities(root, mode)`, `renderToolDetail(root, id)` |
| `evals/tools.ts` | `makeHandlers(root)` → deterministic handlers (search/read/query/remember/invoke/list) |
| `evals/server.ts` | `buildEvalServer(config, root)` → `McpServer` with per-config tools + instructions |
| `evals/caller.ts` | `runCaller(opts)` → tool-use loop (injectable model + callTool) → `LegResult` |
| `evals/adapters.ts` | `connectInMemory(server)`, `anthropicModel(client, model)`, `mcpCallTool(client)` |
| `evals/configs.ts` | Named configs (leading + B/C/D/E) |
| `evals/scenarios.ts` | Scenario fixtures (cross-tool journeys + negatives) |
| `evals/run.ts` | Matrix runner → scorecard table + JSON; `npm run eval` entry |
| `evals/fixtures/vault/` | Committed fixture vault (context files + `tools/<id>/manifest.json`) |
| `test/evals/scorer.test.ts` | Unit tests for scorer |
| `test/evals/capabilities.test.ts` | Unit tests for capabilities rendering |
| `test/evals/tools.test.ts` | Unit tests for deterministic handlers |
| `test/evals/caller.test.ts` | Unit tests for the tool-use loop (scripted model) |

---

## Task 1: Scaffold (deps, script, types, gitignore)

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `evals/types.ts`

- [ ] **Step 1: Add the dev dependency + eval script**

In `package.json`, add to `"scripts"`:
```json
"eval": "tsx evals/run.ts"
```
Add to `"devDependencies"` (the package is already present transitively at 0.104.2; declaring it makes it direct):
```json
"@anthropic-ai/sdk": "^0.104.2"
```

- [ ] **Step 2: Install + ignore results**

Run: `npm install`
Append to `.gitignore`:
```
evals/results/
```

- [ ] **Step 3: Write shared types**

Create `evals/types.ts`:
```ts
/** How a tool's actions are executed server-side (the caller never sees the difference). */
export type Executor = "http" | "cli" | "mcp";

/** A named, credentialed instance of a tool (e.g. gmail "companyB"), with health for the caller. */
export interface Connection { label: string; status: "connected" | "needs_reconnect"; description?: string }

/** One callable action of a tool, with its parameters. */
export interface ToolAction { description: string; params: { name: string; required: boolean }[] }

/** A vault tool: one manifest, one or more connections, one `invoke` door regardless of executor. */
export interface ToolManifest {
  id: string;
  name: string;
  type: Executor;
  description: string;
  connections?: Connection[];
  actions: Record<string, ToolAction>;
}

/** Names of the candidate MCP tools the harness can register. */
export type ToolName = "list_capabilities" | "search" | "read" | "query" | "remember" | "invoke";

/** One tool call the caller made, with the text result it received back. */
export interface ToolCall { name: string; args: Record<string, unknown>; result: string }
/** Ordered record of every tool call in one caller conversation. */
export type Trace = ToolCall[];

/** A tool-surface variant under test. */
export interface EvalConfig {
  name: string;
  tools: ToolName[];
  descriptions: Record<string, string>;
  serverInstructions: string;
  listMode: "flat" | "tiered";
}

/** Whether the vault SHOULD or should NOT be reached for in a scenario. */
export type ScenarioClass = "should-use" | "should-not-use";

/** What correct caller behavior looks like for one leg. */
export interface Expect {
  discovers?: boolean;
  readsFile?: string;
  invokes?: { tool: string; action: string; connection?: string };
  remembers?: boolean;
}

/** One user turn within a scenario (most scenarios have one leg; store→retrieve has two). */
export interface ScenarioLeg { prompt: string; expect: Expect }
/** A scenario: an ordered set of legs sharing one vault copy. */
export interface Scenario { id: string; cls: ScenarioClass; legs: ScenarioLeg[] }

/** The caller's output for one leg. */
export interface LegResult { trace: Trace; finalText: string }

/** Per-leg score. `null` = not applicable to this leg/class. */
export interface LegMetrics {
  discovered: boolean | null;
  correctRetrieval: boolean | null;
  correctInvoke: boolean | null;
  falseTrigger: boolean | null;
  remembered: boolean | null;
  heavyQueryCalls: number;
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git checkout -b feat/caller-surface-eval   # if on main
git add package.json package-lock.json .gitignore evals/types.ts
git commit -m "chore(evals): scaffold caller-surface eval harness"
```

---

## Task 2: Scorer (pure, TDD)

**Files:**
- Create: `evals/scorer.ts`
- Test: `test/evals/scorer.test.ts`

The vault-read tool names are `list_capabilities | search | read | query`. A negative scenario is "false-triggered" if ANY vault tool is called.

- [ ] **Step 1: Write the failing test**

Create `test/evals/scorer.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/evals/scorer.test.ts`
Expected: FAIL ("Cannot find module ../../evals/scorer.js" / exports undefined).

- [ ] **Step 3: Implement the scorer**

Create `evals/scorer.ts`:
```ts
import type { Trace, Expect, ScenarioClass, LegMetrics } from "./types.js";

const READ_TOOLS = new Set(["list_capabilities", "search", "read", "query"]);
const arg = (c: Trace[number], k: string): unknown => c.args[k];

/** Scores one caller leg against its expectations, returning per-metric booleans (null = N/A). */
export function scoreLeg(trace: Trace, expect: Expect, cls: ScenarioClass): LegMetrics {
  const calledAnyVault = trace.some((c) => READ_TOOLS.has(c.name) || c.name === "invoke" || c.name === "remember");
  const reachedContent = (needle: string) => trace.some((c) => c.result.toLowerCase().includes(needle.toLowerCase()));
  const heavyQueryCalls = trace.filter((c) => c.name === "query").length;

  const discovered = expect.discovers ? trace.some((c) => READ_TOOLS.has(c.name)) : null;
  const correctRetrieval = expect.readsFile ? reachedContent(expect.readsFile) : null;

  let correctInvoke: boolean | null = null;
  if (expect.invokes) {
    const want = expect.invokes;
    correctInvoke = trace.some((c) => {
      if (c.name !== "invoke") return false;
      const tool = (arg(c, "tool") ?? arg(c, "integration")) as string | undefined;
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
    const k = `${r.config} ${r.tier}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/evals/scorer.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**
```bash
git add evals/scorer.ts test/evals/scorer.test.ts
git commit -m "feat(evals): pure trace scorer + aggregation"
```

---

## Task 3: Fixture vault

**Files:**
- Create: `evals/fixtures/vault/index.md`
- Create: `evals/fixtures/vault/sops/deploy-staging.md`
- Create: `evals/fixtures/vault/clients/acme/preferences.md`
- Create: `evals/fixtures/vault/context/company-z/tone-of-voice.md`
- Create: `evals/fixtures/vault/context/sales-pipeline.md`
- Create: `evals/fixtures/vault/tools/gmail/manifest.json`
- Create: `evals/fixtures/vault/tools/linear/manifest.json`
- Create: `evals/fixtures/vault/tools/cloakbrowser/manifest.json`
- Create: `evals/fixtures/vault/tools/github/manifest.json`

- [ ] **Step 1: Context files**

`evals/fixtures/vault/index.md`:
```markdown
# Vault index
- sops/deploy-staging.md — how we deploy & smoke-test staging
- clients/acme/preferences.md — Acme's eslint + PR conventions
- context/company-z/tone-of-voice.md — Company Z writing voice
- context/sales-pipeline.md — the outbound sales pipeline steps
- tools/ — gmail, linear, cloakbrowser, github
```

`evals/fixtures/vault/sops/deploy-staging.md`:
```markdown
---
type: sop
title: Deploy staging
uses: [linear.create_issue]
---
Deploy staging with `fly deploy -a acme-staging`. Then smoke-test with `npm run smoke`.
```

`evals/fixtures/vault/clients/acme/preferences.md`:
```markdown
---
type: note
title: Acme preferences
---
Acme uses 2-space indent, single quotes, and squash-merge PRs. Eslint config: airbnb-base.
```

`evals/fixtures/vault/context/company-z/tone-of-voice.md`:
```markdown
---
type: note
title: Company Z tone of voice
---
Company Z writes warm, concise, first-name, no corporate jargon.
```

`evals/fixtures/vault/context/sales-pipeline.md`:
```markdown
---
type: sop
title: Sales pipeline
uses: [gmail.send]
---
1. Qualify the lead. 2. Send intro email in the company's tone. 3. Log the lead in Linear.
```

- [ ] **Step 2: Tool manifests (one shape, three executors, multi-connection)**

`evals/fixtures/vault/tools/gmail/manifest.json`:
```json
{
  "id": "gmail",
  "name": "Gmail",
  "type": "cli",
  "description": "Send and read email from your Gmail accounts.",
  "connections": [
    { "label": "private", "status": "connected", "description": "Personal inbox" },
    { "label": "companyA", "status": "connected", "description": "Company A inbox" },
    { "label": "companyB", "status": "connected", "description": "Company B (Acme) sales inbox" }
  ],
  "actions": {
    "send": { "description": "Send an email.", "params": [
      { "name": "to", "required": true }, { "name": "subject", "required": true }, { "name": "body", "required": true } ] }
  }
}
```

`evals/fixtures/vault/tools/linear/manifest.json`:
```json
{
  "id": "linear", "name": "Linear", "type": "http",
  "description": "Create and update Linear issues.",
  "connections": [ { "label": "default", "status": "connected" } ],
  "actions": { "create_issue": { "description": "Create an issue.", "params": [
    { "name": "title", "required": true }, { "name": "description", "required": false } ] } }
}
```

`evals/fixtures/vault/tools/cloakbrowser/manifest.json`:
```json
{
  "id": "cloakbrowser", "name": "CloakBrowser", "type": "cli",
  "description": "A headless browser that passes bot detection; fetch pages that block normal scrapers.",
  "connections": [ { "label": "default", "status": "connected" } ],
  "actions": { "fetch": { "description": "Fetch a URL bypassing bot detection.", "params": [
    { "name": "url", "required": true } ] } }
}
```

`evals/fixtures/vault/tools/github/manifest.json`:
```json
{
  "id": "github", "name": "GitHub", "type": "mcp",
  "description": "GitHub operations (PRs, issues) via the GitHub MCP, proxied through the vault.",
  "connections": [ { "label": "default", "status": "needs_reconnect" } ],
  "actions": { "open_pr": { "description": "Open a pull request.", "params": [
    { "name": "title", "required": true }, { "name": "head", "required": true }, { "name": "base", "required": true } ] } }
}
```

- [ ] **Step 3: Commit (verified by Task 4's tests)**
```bash
git add evals/fixtures/vault
git commit -m "test(evals): fixture vault (context + tools/ manifests)"
```

---

## Task 4: Capabilities rendering (TDD)

**Files:**
- Create: `evals/capabilities.ts`
- Test: `test/evals/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/evals/capabilities.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadManifests, renderCapabilities, renderToolDetail } from "../../evals/capabilities.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "fixtures", "vault");

describe("capabilities", () => {
  it("loads all tool manifests", () => {
    const ids = loadManifests(ROOT).map((m) => m.id).sort();
    expect(ids).toEqual(["cloakbrowser", "github", "gmail", "linear"]);
  });

  it("tiered L1 lists tools + connection labels/status but NOT action params", () => {
    const text = renderCapabilities(ROOT, "tiered");
    expect(text).toContain("gmail");
    expect(text).toContain("companyB");
    expect(text).toContain("needs_reconnect"); // github status surfaced
    expect(text).not.toContain('"required"'); // no raw param schema in L1
  });

  it("flat includes action names inline", () => {
    const text = renderCapabilities(ROOT, "flat");
    expect(text).toContain("send");
    expect(text).toContain("create_issue");
  });

  it("tool detail exposes actions + params for one tool", () => {
    const text = renderToolDetail(ROOT, "gmail");
    expect(text).toContain("send");
    expect(text).toContain("to");
    expect(text).toContain("subject");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/evals/capabilities.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement capabilities rendering**

Create `evals/capabilities.ts`:
```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolManifest } from "./types.js";

/** Reads every `tools/<id>/manifest.json` under the vault root. */
export function loadManifests(root: string): ToolManifest[] {
  const dir = join(root, "tools");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name, "manifest.json"))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, "utf8")) as ToolManifest)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const conns = (m: ToolManifest): string =>
  (m.connections ?? []).map((c) => `${c.label} (${c.status})`).join(", ");

/** The L1 map (`tiered`) or full dump (`flat`) plus the context index. */
export function renderCapabilities(root: string, mode: "flat" | "tiered"): string {
  const indexPath = join(root, "index.md");
  const context = existsSync(indexPath) ? readFileSync(indexPath, "utf8").trim() : "";
  const tools = loadManifests(root).map((m) => {
    const head = `- ${m.id} [${m.type}] — ${m.description} · connections: ${conns(m) || "—"}`;
    if (mode === "tiered") return head;
    const actions = Object.entries(m.actions).map(([a, def]) => `    - ${a}: ${def.description}`).join("\n");
    return `${head}\n${actions}`;
  });
  const drill = mode === "tiered" ? "\nUse list_capabilities(tool: <id>) for a tool's actions + params." : "";
  return `# Context\n${context}\n\n# Tools\n${tools.join("\n")}${drill}`;
}

/** L2 drill-down: actions + params for one tool. */
export function renderToolDetail(root: string, id: string): string {
  const m = loadManifests(root).find((t) => t.id === id);
  if (!m) return `Unknown tool: ${id}`;
  const actions = Object.entries(m.actions).map(([a, def]) => {
    const params = def.params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ");
    return `- ${a}(${params}) — ${def.description}`;
  }).join("\n");
  return `# ${m.id} [${m.type}]\nconnections: ${conns(m) || "—"}\n${actions}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/evals/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add evals/capabilities.ts test/evals/capabilities.test.ts
git commit -m "feat(evals): flat/tiered capabilities rendering over tools/ layout"
```

---

## Task 5: Deterministic tool handlers (TDD)

**Files:**
- Create: `evals/tools.ts`
- Test: `test/evals/tools.test.ts`

Handlers are `(args) => Promise<string>`. They operate on a vault root. `remember` writes a deterministic file (sha1 of content) so store→retrieve has ground truth. `invoke` validates the tool/action exist (so a bad call errors). `search` greps file contents.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHandlers } from "../../evals/tools.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "fixtures", "vault");
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-eval-")); cpSync(FIX, root, { recursive: true }); });

describe("handlers", () => {
  it("search returns matching file paths + snippets", async () => {
    const h = makeHandlers(root, "tiered");
    const out = await h.search({ query: "fly deploy" });
    expect(out).toContain("deploy-staging");
    expect(out.toLowerCase()).toContain("fly deploy");
  });

  it("read returns file contents", async () => {
    const h = makeHandlers(root, "tiered");
    const out = await h.read({ path: "clients/acme/preferences.md" });
    expect(out).toContain("airbnb-base");
  });

  it("read refuses to escape the vault", async () => {
    const h = makeHandlers(root, "tiered");
    await expect(h.read({ path: "../../etc/passwd" })).rejects.toThrow();
  });

  it("remember writes a findable note", async () => {
    const h = makeHandlers(root, "tiered");
    await h.remember({ content: "We deploy prod with fly deploy -a acme-prod." });
    const out = await h.search({ query: "acme-prod" });
    expect(out).toContain("acme-prod");
  });

  it("invoke validates the action exists and echoes the connection", async () => {
    const h = makeHandlers(root, "tiered");
    const out = await h.invoke({ tool: "gmail", action: "send", connection: "companyB", params: { to: "josh" } });
    expect(out).toContain("companyB");
    await expect(h.invoke({ tool: "gmail", action: "nope" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/evals/tools.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement handlers**

Create `evals/tools.ts`:
```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { renderCapabilities, renderToolDetail, loadManifests } from "./capabilities.js";

/** Resolves a vault-relative path, throwing if it escapes the root. */
function safe(root: string, p: string): string {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes vault: ${p}`);
  return abs;
}

/** Recursively lists files under a dir (vault-relative, forward slashes), skipping .git. */
function walk(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(root, p));
    else out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

/** The set of deterministic tool handlers bound to one vault root + list mode. */
export function makeHandlers(root: string, listMode: "flat" | "tiered") {
  return {
    /** Returns the capability map (L1) or, if `tool` given, that tool's detail (L2). */
    async list_capabilities(args: { tool?: string } = {}): Promise<string> {
      return args.tool ? renderToolDetail(root, args.tool) : renderCapabilities(root, listMode);
    },
    /** Greps vault file contents and returns matching paths + a snippet. */
    async search(args: { query: string }): Promise<string> {
      const q = String(args.query ?? "").toLowerCase();
      const hits: string[] = [];
      for (const rel of walk(root)) {
        if (rel.endsWith(".json")) continue;
        const text = readFileSync(join(root, rel), "utf8");
        const i = text.toLowerCase().indexOf(q);
        if (q && i >= 0) hits.push(`${rel}: …${text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ").trim()}…`);
      }
      return hits.length ? hits.join("\n") : "no matches";
    },
    /** Returns the raw contents of a vault file. */
    async read(args: { path: string }): Promise<string> {
      const abs = safe(root, String(args.path ?? ""));
      if (!existsSync(abs) || statSync(abs).isDirectory()) throw new Error(`not a file: ${args.path}`);
      return readFileSync(abs, "utf8");
    },
    /** Canned heavyweight-synthesis response (the internal agent is stubbed for the eval). */
    async query(args: { instruction: string }): Promise<string> {
      const found = await this.search({ query: String(args.instruction ?? "").split(/\s+/).slice(0, 3).join(" ") });
      return `Synthesized from your vault:\n${found}`;
    },
    /** Writes a deterministic note so store→retrieve scenarios have ground truth. */
    async remember(args: { content: string; title?: string }): Promise<string> {
      const content = String(args.content ?? "");
      const slug = createHash("sha1").update(content).digest("hex").slice(0, 8);
      const dir = join(root, "notes");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${slug}.md`), `---\ntitle: ${args.title ?? "note"}\n---\n${content}\n`);
      return `Filed note notes/${slug}.md`;
    },
    /** Validates the tool/action exist and echoes the call (executor is stubbed). */
    async invoke(args: { tool?: string; integration?: string; action: string; connection?: string; params?: unknown }): Promise<string> {
      const id = String(args.tool ?? args.integration ?? "");
      const m = loadManifests(root).find((t) => t.id === id);
      if (!m) throw new Error(`unknown tool: ${id}`);
      if (!m.actions[String(args.action)]) throw new Error(`unknown action: ${id}.${args.action}`);
      return JSON.stringify({ status: 200, tool: id, action: args.action, connection: args.connection ?? "default", ok: true });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/evals/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add evals/tools.ts test/evals/tools.test.ts
git commit -m "feat(evals): deterministic vault tool handlers"
```

---

## Task 6: Eval MCP server builder

**Files:**
- Create: `evals/server.ts`

Registers only the tools named in `config.tools`, with per-config descriptions and server `instructions`. `list_capabilities` gets an optional `tool` param so the caller can drill down (used only in `tiered` mode but harmless in flat).

- [ ] **Step 1: Implement the builder**

Create `evals/server.ts`:
```ts
import { z, type ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EvalConfig, ToolName } from "./types.js";
import { makeHandlers } from "./tools.js";

const SCHEMAS: Record<ToolName, ZodRawShape> = {
  list_capabilities: { tool: z.string().optional() },
  search: { query: z.string() },
  read: { path: z.string() },
  query: { instruction: z.string() },
  remember: { content: z.string(), title: z.string().optional(), source: z.string().optional() },
  invoke: { tool: z.string(), action: z.string(), connection: z.string().optional(), params: z.record(z.string(), z.any()).optional() },
};

/** Builds an MCP server exposing exactly the tools in `config`, with its descriptions + instructions, over `root`. */
export function buildEvalServer(config: EvalConfig, root: string): McpServer {
  const server = new McpServer({ name: "geode-kernel", version: "0.1.0" }, { instructions: config.serverInstructions });
  const handlers = makeHandlers(root, config.listMode) as Record<string, (a: any) => Promise<string>>;
  for (const name of config.tools) {
    server.registerTool(
      name,
      { description: config.descriptions[name] ?? name, inputSchema: SCHEMAS[name] },
      async (args: unknown) => {
        try {
          const text = await handlers[name](args ?? {});
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: `${name} failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
      },
    );
  }
  return server;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git add evals/server.ts
git commit -m "feat(evals): config-driven MCP server builder"
```

---

## Task 7: Caller tool-use loop (TDD with scripted model)

**Files:**
- Create: `evals/caller.ts`
- Test: `test/evals/caller.test.ts`

The loop is model-agnostic: inject a `ModelFn` (so tests script turns) and a `CallToolFn`. It records `{name, args, result}` per tool call.

- [ ] **Step 1: Write the failing test**
```ts
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
  });

  it("stops at maxTurns even if the model keeps calling tools", async () => {
    const res = await runCaller({
      tools: [{ name: "x", description: "", input_schema: { type: "object" } }],
      model: async () => ({ text: "", toolCalls: [{ id: "1", name: "x", input: {} }] }),
      callTool: async () => "r",
      system: "s", prompt: "p", maxTurns: 3,
    });
    expect(res.trace.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/evals/caller.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the loop**

Create `evals/caller.ts`:
```ts
import type { Trace, LegResult } from "./types.js";

/** A tool as the model sees it (Anthropic tool-definition shape). */
export interface ModelTool { name: string; description: string; input_schema: Record<string, unknown> }
/** One model turn: prose plus zero or more tool calls. */
export interface ModelTurn { text: string; toolCalls: { id: string; name: string; input: Record<string, unknown> }[] }
/** Produces the next model turn given the running message history. */
export type ModelFn = (req: { system: string; tools: ModelTool[]; messages: Msg[] }) => Promise<ModelTurn>;
/** Executes a tool call against the MCP server, returning its text result. */
export type CallToolFn = (name: string, input: Record<string, unknown>) => Promise<string>;
/** A message in the running conversation (provider-neutral). */
export interface Msg { role: "user" | "assistant"; content: unknown }

/** Drives a caller conversation: model → tool calls → results → repeat, capping at maxTurns. */
export async function runCaller(opts: {
  tools: ModelTool[]; model: ModelFn; callTool: CallToolFn; system: string; prompt: string; maxTurns: number;
}): Promise<LegResult> {
  const messages: Msg[] = [{ role: "user", content: opts.prompt }];
  const trace: Trace = [];
  let finalText = "";
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const { text, toolCalls } = await opts.model({ system: opts.system, tools: opts.tools, messages });
    if (text) finalText = text;
    if (toolCalls.length === 0) break;
    const assistantContent = [
      ...(text ? [{ type: "text", text }] : []),
      ...toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
    ];
    messages.push({ role: "assistant", content: assistantContent });
    const results = [];
    for (const c of toolCalls) {
      let result: string;
      try { result = await opts.callTool(c.name, c.input); }
      catch (e) { result = `error: ${e instanceof Error ? e.message : String(e)}`; }
      trace.push({ name: c.name, args: c.input, result });
      results.push({ type: "tool_result", tool_use_id: c.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }
  return { trace, finalText };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/evals/caller.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add evals/caller.ts test/evals/caller.test.ts
git commit -m "feat(evals): injectable caller tool-use loop"
```

---

## Task 8: Adapters (in-memory MCP client + Anthropic model)

**Files:**
- Create: `evals/adapters.ts`

Wires the real MCP client (in-memory) and the real Anthropic model into the loop's injection points.

- [ ] **Step 1: Implement adapters**

Create `evals/adapters.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelFn, ModelTool, CallToolFn } from "./caller.js";

/** Connects an in-process MCP client to `server`; returns its tools (as model defs) + server instructions. */
export async function connectInMemory(server: McpServer): Promise<{ client: Client; tools: ModelTool[]; instructions: string }> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "eval-caller", version: "0.1.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  return {
    client,
    instructions: client.getInstructions() ?? "",
    tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Record<string, unknown> })),
  };
}

/** Calls an MCP tool and flattens its content to text. */
export function mcpCallTool(client: Client): CallToolFn {
  return async (name, input) => {
    const r: any = await client.callTool({ name, arguments: input });
    return (r.content ?? []).map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n");
  };
}

/** Wraps the Anthropic Messages API as a ModelFn (tool-use, auto tool_choice). */
export function anthropicModel(client: Anthropic, model: string): ModelFn {
  return async ({ system, tools, messages }) => {
    const res = await client.messages.create({
      model, max_tokens: 1024, system,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as any })),
      messages: messages as any,
    });
    let text = "";
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    return { text, toolCalls };
  };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git add evals/adapters.ts
git commit -m "feat(evals): in-memory MCP + Anthropic adapters"
```

---

## Task 9: Configs

**Files:**
- Create: `evals/configs.ts`

The leading candidate + the variants from the spec. Descriptions for the candidate are trigger-situation phrased; the baseline mimics the current jargon + empty instructions.

- [ ] **Step 1: Implement configs**

Create `evals/configs.ts`:
```ts
import type { EvalConfig } from "./types.js";

const NUDGE =
  "This user has a Geode vault — their own context, SOPs, integrations, and credentials, shared across all their AI assistants. " +
  "Before answering about THEIR projects, preferences, decisions, or 'how we/I usually…', and before any task that may need their tools or credentials, " +
  "call list_capabilities to orient, then search/read what's relevant — it's cheap. To act on a tool, call invoke (the server injects the right connection's secret). " +
  "Save durable learnings with remember. Don't reach into the vault for generic questions unrelated to this user.";

const RICH = {
  list_capabilities: "Map of the user's vault: their context index + every tool with its connections (accounts) and status. Zero-arg and cheap; call it first when a task might touch the user's own context or tools. Pass {tool} to see one tool's actions + params.",
  search: "Search the user's vault for THEIR context — projects, preferences, decisions, SOPs, tone — and read the raw matches yourself before answering. Cheap; prefer it over guessing.",
  read: "Read one vault file by path (from list_capabilities/search results).",
  invoke: "Run one action of a vault tool (the server injects the chosen connection's credentials and executes it). Pick the connection by intent, e.g. the user's company-B account.",
  remember: "Save a distilled, durable learning to the user's vault so their other assistants get it too. Give the essence, not a transcript.",
  query: "LAST RESORT: ask the vault's internal agent to synthesize across many files. Expensive — prefer search/read for direct lookups.",
};

const JARGON = {
  list_capabilities: "List what your Geode vault offers — recipes/skills and integrations with their actions.",
  query: "Ask your Geode vault — it searches your context and returns a synthesized answer, or an executable plan.",
  remember: "Save a distilled learning, fact, or note in your Geode vault.",
  invoke: "Run one action of an integration in your Geode vault.",
};

const ALL = ["list_capabilities", "search", "read", "invoke", "remember", "query"] as const;

/** All tool-surface variants the harness pits against each other. */
export const CONFIGS: EvalConfig[] = [
  { name: "leading", tools: [...ALL], descriptions: RICH, serverInstructions: NUDGE, listMode: "tiered" },
  { name: "B-query-only", tools: ["list_capabilities", "query", "remember", "invoke"], descriptions: JARGON, serverInstructions: "", listMode: "flat" },
  { name: "C-search-only", tools: ["list_capabilities", "search", "invoke", "remember", "query"], descriptions: RICH, serverInstructions: NUDGE, listMode: "tiered" },
  { name: "D-flat-list", tools: [...ALL], descriptions: RICH, serverInstructions: NUDGE, listMode: "flat" },
  { name: "E-minimal-desc", tools: [...ALL], descriptions: { list_capabilities: "list", search: "search", read: "read", invoke: "invoke", remember: "remember", query: "query" }, serverInstructions: NUDGE, listMode: "tiered" },
];
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git add evals/configs.ts
git commit -m "feat(evals): leading candidate + variant configs"
```

---

## Task 10: Scenarios

**Files:**
- Create: `evals/scenarios.ts`

The cross-tool journeys + negatives from the spec. The store→retrieve scenario has two legs sharing one vault copy.

- [ ] **Step 1: Implement scenarios**

Create `evals/scenarios.ts`:
```ts
import type { Scenario } from "./types.js";

/** The behavioral scenarios scored per config + tier. */
export const SCENARIOS: Scenario[] = [
  {
    id: "store-then-retrieve", cls: "should-use",
    legs: [
      { prompt: "Remember for next time: we deploy staging with `fly deploy -a acme-staging`, then smoke-test with `npm run smoke`.", expect: { remembers: true } },
      { prompt: "Deploy staging.", expect: { discovers: true, readsFile: "acme-staging" } },
    ],
  },
  {
    id: "tool-portability", cls: "should-use",
    legs: [{ prompt: "File a Linear issue: 'login button overlaps on mobile'.", expect: { discovers: true, invokes: { tool: "linear", action: "create_issue" } } }],
  },
  {
    id: "multi-connection", cls: "should-use",
    legs: [{ prompt: "Email Josh (josh@acme.com) from my company B account to confirm tomorrow's demo.", expect: { invokes: { tool: "gmail", action: "send", connection: "companyB" } } }],
  },
  {
    id: "context-compose", cls: "should-use",
    legs: [{ prompt: "Draft and send the intro email for a new lead following our sales pipeline, in company Z's voice.", expect: { discovers: true, readsFile: "tone", invokes: { tool: "gmail", action: "send" } } }],
  },
  {
    id: "installed-repo-tool", cls: "should-use",
    legs: [{ prompt: "Fetch the pricing page at https://example.com/pricing — it blocks normal scrapers.", expect: { discovers: true, invokes: { tool: "cloakbrowser", action: "fetch" } } }],
  },
  {
    id: "should-use-direct", cls: "should-use",
    legs: [{ prompt: "What eslint convention do we use for Acme?", expect: { discovers: true, readsFile: "airbnb" } }],
  },
  {
    id: "negative-math", cls: "should-not-use",
    legs: [{ prompt: "What's 2 + 2?", expect: {} }],
  },
  {
    id: "negative-fizzbuzz", cls: "should-not-use",
    legs: [{ prompt: "Write a fizzbuzz function in Python.", expect: {} }],
  },
];
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git add evals/scenarios.ts
git commit -m "feat(evals): cross-tool journey + negative scenarios"
```

---

## Task 11: Matrix runner + scorecard

**Files:**
- Create: `evals/run.ts`

Per (config × tier × scenario × repeat): copy the fixture vault to a temp dir, build the server, connect the in-memory client, run each leg as a fresh caller conversation over the shared copy, score, accumulate. Print a table + write JSON. CLI/env knobs keep cost bounded.

- [ ] **Step 1: Implement the runner**

Create `evals/run.ts`:
```ts
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
    const model = anthropicModel(anthropic, tierModel);
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
```

- [ ] **Step 2: Offline smoke (no API spend) — scripted-model dry run**

Add a guard so a dry run uses a scripted model. At the top of `main()`, after `const anthropic = new Anthropic();`, insert:
```ts
  if (process.env.GEODE_EVAL_DRY) {
    // Offline determinism check: replace the model with one that always lists then stops.
    (anthropic as any)._dry = true;
  }
```
Then in `runScenario`, choose the model:
```ts
    const model = (anthropic as any)._dry
      ? async () => ({ text: "ok", toolCalls: [{ id: "1", name: config.tools[0], input: config.tools[0] === "search" ? { query: "deploy" } : {} }] })
      : anthropicModel(anthropic, tierModel);
```

Run: `GEODE_EVAL_DRY=1 GEODE_EVAL_TIERS=weak GEODE_EVAL_REPEATS=1 GEODE_EVAL_CONFIGS=leading npm run eval`
Expected: prints a scorecard table and "Wrote …/latest.json" with no network calls.

- [ ] **Step 3: Commit**
```bash
git add evals/run.ts
git commit -m "feat(evals): matrix runner + scorecard + JSON output"
```

---

## Task 12: First real run + README

**Files:**
- Create: `evals/README.md`

- [ ] **Step 1: Small real run (one config, weak tier)**

Ensure `ANTHROPIC_API_KEY` (or `ANTHROPIC_BASE_URL` for a local model) is set.
Run: `GEODE_EVAL_TIERS=weak GEODE_EVAL_REPEATS=2 GEODE_EVAL_CONFIGS=leading,B-query-only npm run eval`
Expected: a scorecard where `leading` shows higher `disc`/`retr` than `B-query-only` on the should-use scenarios, and both show low `false` on negatives. (If not, that is itself a finding — record it; do not "fix" the harness to force a result.)

- [ ] **Step 2: Write the eval README**

Create `evals/README.md`:
```markdown
# Caller-surface eval

Measures how well different MCP tool-surfaces let an arbitrary caller agent discover + use the vault. See the spec: `docs/superpowers/specs/2026-06-26-mcp-caller-surface-eval-design.md`.

## Run
```
ANTHROPIC_API_KEY=… npm run eval
```
Env knobs: `GEODE_EVAL_TIERS=strong,weak` · `GEODE_EVAL_CONFIGS=leading,B-query-only` · `GEODE_EVAL_REPEATS=3` · `GEODE_EVAL_STRONG=…` · `GEODE_EVAL_WEAK=…` · `GEODE_EVAL_DRY=1` (offline scripted model).

## What it scores (from the tool-call trace)
disc=reached in when it should · retr=right content reached the caller · invk=right tool+action+connection · false=touched vault on a negative (lower better) · rem=remembered when expected · qry/leg=heavy `query` calls (lower better).

## Iterating
Edit `configs.ts` (tools/descriptions/instructions/listMode) and re-run. Results in `results/latest.json`.
```

- [ ] **Step 3: Full unit-test sweep + commit**

Run: `npm test`
Expected: all vitest suites pass (scorer, capabilities, tools, caller — plus the existing suites untouched).
```bash
git add evals/README.md
git commit -m "docs(evals): how to run + iterate the caller-surface eval"
```

---

## Self-review notes

- **Spec coverage:** caller runner (T7/T8) ✓; stub engine → handlers (T5) ✓; fixture vault w/ tools layout + multi-conn + status (T3) ✓; config incl. `listMode` (T9) ✓; scenarios incl. two-leg + negatives + multi-connection + context-compose + repo + mcp fixture (T10/T3) ✓; trace scorer w/ connection + false-trigger + heavy-query (T2) ✓; matrix + scorecard + JSON, excluded from CI (T11) ✓; weak+strong tiers, per-tier scorecard (T11) ✓; success criteria 1–4 covered by T11/T12.
- **Out of scope (correctly absent):** real OAuth/subprocess execution, organised registration, LLM judge, CI wiring.
- **Vault-as-hub / §2.1 update:** deliberately NOT built here — `query` stays a tool (de-emphasized); §2.1 doc edit deferred to post-eval per "tests first, then docs".
```

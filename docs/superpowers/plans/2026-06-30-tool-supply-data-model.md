# Tool-supply data model (slice #2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `integrations/` model with the unified `tools/<id>/TOOL.md` model (three executor types `http`/`cli`/`mcp`, multi-connection credentials, declared `runtime`) end-to-end — MCP path, secrets, dashboard backend, and React frontend — so `http` tools work fully and `cli`/`mcp` are listable-but-not-runnable (executors = #3).

**Architecture:** `TOOL.md` = YAML frontmatter (parsed via the `yaml` lib) + a markdown doc body. Per-connection credentials are flat composite secret refs `"<tool>__<label>__<KEY>"` (reusing the existing AES store + secret-link flow unchanged). `invoke` resolves the connection bundle and dispatches by `type`. Full-stack rename `integrations` → `tools` (no back-compat — pre-release). Each phase ends green; old code is removed only in Phase 7.

**Tech Stack:** TypeScript ESM, `yaml@2.9.0` (already in the tree, declare as direct dep), vitest, Express dashboard, React/Vite frontend.

**Spec:** `docs/superpowers/specs/2026-06-29-tool-supply-data-model-design.md`

**Branch:** `feat/tool-supply-2a` (already on it). Husky pre-commit gate requires JSDoc on exports. Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File map

| File | Change |
|---|---|
| `package.json` | declare `yaml` dep |
| `src/tools.ts` | **new** — `ToolManifest` types, `loadTool`, `listToolIds`, `resolveTemplate`, `connRef`, `resolveConnection`, `loadConnBundle`, `connectionConfigured` |
| `src/integrations.ts` | **deleted** (Phase 7) |
| `src/invoke.ts` | rewrite onto `tools.ts`; `InvokeArgs{tool,action,params?,connection?}`; dispatch by type |
| `src/capabilities.ts` | scan `tools/`; `deriveCapabilities(root, secrets)` with connection status; exclude `tools/` from recipe walk |
| `src/server.ts`, `src/toolCatalog.ts` | invoke schema `integration`→`tool`+`connection`; list_capabilities passes secrets |
| `src/constitution.ts` | reference `tools/<id>/TOOL.md` |
| `src/dashboard/ops.ts` | `listTools`/`getTool`/`ToolView`; `listSecrets` via composite refs |
| `src/dashboard/api.ts` | routes `/integrations*`→`/tools*`; `/tools/:id/test`→`invoke({tool,action,connection})`; `/capabilities` passes secrets |
| `src/dashboard/knowledge.ts` | exclude `tools/` |
| `src/dashboard/index.ts` | invoke wiring signature |
| `examples/integrations/httpbin/manifest.json` | → `examples/tools/httpbin/TOOL.md` |
| `web/src/api.ts` | `ToolView`, `tools()/tool()/testAction()` URLs, capabilities `tools` field |
| `web/src/views/Integrations.tsx` | → `web/src/views/Tools.tsx` |
| `web/src/App.tsx`, `components/TopBar.tsx`, `views/Capabilities.tsx`, `views/Secrets.tsx` | rename refs + labels |
| tests | `integrations.test.ts`→`tools.test.ts`; update `invoke`/`capabilities`/`secrets`/dashboard tests |

---

## Phase 1 — `tools.ts` (new, TDD)

### Task 1: tool manifest model + loader

**Files:** Modify `package.json`; Create `src/tools.ts`, `test/tools.test.ts`.

- [ ] **Step 1: declare the yaml dep**

In `package.json` `dependencies`, add (it is already resolved at 2.9.0):
```json
"yaml": "^2.9.0"
```
Run: `npm install` (no-op install confirming it resolves).

- [ ] **Step 2: write the failing test**

Create `test/tools.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { loadTool, listToolIds, resolveTemplate, connRef, resolveConnection } from "../src/tools.js";

function vault(): string { return mkdtempSync(join(tmpdir(), "geode-tools-")); }
function writeTool(root: string, id: string, md: string): void {
  mkdirSync(join(root, "tools", id), { recursive: true });
  writeFileSync(join(root, "tools", id, "TOOL.md"), md);
}

const HTTP = `---
id: linear
name: Linear
type: http
description: Create issues.
requires: [API_KEY]
connections:
  - { label: default }
actions:
  create_issue:
    params: [{ name: title, required: true }]
    http:
      method: POST
      url: https://api.linear.app/graphql
      headers: { Authorization: "Bearer \${conn.API_KEY}" }
---
Body docs here.
`;

const CLI = `---
id: gmail
name: Gmail
type: cli
description: Send email.
runtime: host
requires: [TOKEN]
source: { repo: "https://github.com/x/gog", ref: "v1" }
install: ["npm ci"]
bin: "./gog"
materialize: { inject: env, env: { GOG_TOKEN: "\${conn.TOKEN}" } }
connections:
  - { label: acme-sales, description: "Company B inbox" }
actions:
  send:
    params: [{ name: to, required: true }]
    command: "send --to \${params.to}"
---
`;

test("loadTool parses http frontmatter + body", async () => {
  const root = vault(); writeTool(root, "linear", HTTP);
  const t = await loadTool(root, "linear");
  expect(t.type).toBe("http");
  expect(t.requires).toEqual(["API_KEY"]);
  expect(t.actions.create_issue.http?.method).toBe("POST");
  expect(t.body?.trim()).toBe("Body docs here.");
});

test("loadTool parses cli frontmatter (source/install/bin/materialize/command)", async () => {
  const root = vault(); writeTool(root, "gmail", CLI);
  const t = await loadTool(root, "gmail");
  expect(t.type).toBe("cli");
  expect(t.runtime).toBe("host");
  expect(t.source?.repo).toContain("github.com");
  expect(t.bin).toBe("./gog");
  expect(t.actions.send.command).toBe("send --to ${params.to}");
  expect(t.connections?.[0].label).toBe("acme-sales");
});

test("loadTool rejects a traversal id and a missing tool", async () => {
  const root = vault();
  await expect(loadTool(root, "../../etc")).rejects.toThrow(/invalid tool id/);
  await expect(loadTool(root, "nope")).rejects.toThrow();
});

test("listToolIds lists tool directories", async () => {
  const root = vault(); writeTool(root, "linear", HTTP); writeTool(root, "gmail", CLI);
  expect((await listToolIds(root)).sort()).toEqual(["gmail", "linear"]);
});

test("resolveTemplate fills params and conn, throws on unresolved", () => {
  const ctx = { params: { to: "josh" }, conn: { TOKEN: "abc" } };
  expect(resolveTemplate("send --to ${params.to} key=${conn.TOKEN}", ctx)).toBe("send --to josh key=abc");
  expect(() => resolveTemplate("${conn.MISSING}", ctx)).toThrow(/unresolved/);
});

test("connRef composes a flat secret ref", () => {
  expect(connRef("gmail", "acme-sales", "TOKEN")).toBe("gmail__acme-sales__TOKEN");
});

test("resolveConnection: explicit valid/invalid, single default, multi requires choice", () => {
  const one = [{ label: "default" }];
  const many = [{ label: "a" }, { label: "b" }];
  expect(resolveConnection(one, undefined)).toBe("default");
  expect(resolveConnection(many, "b")).toBe("b");
  expect(() => resolveConnection(many, "zzz")).toThrow(/not a connection/);
  expect(() => resolveConnection(many, undefined)).toThrow(/specify a connection/);
  expect(resolveConnection([], undefined)).toBeUndefined();
});
```

- [ ] **Step 3: run it — expect FAIL**

Run: `npx vitest run test/tools.test.ts` → FAIL (module not found).

- [ ] **Step 4: implement `src/tools.ts`**

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/** How a tool's actions are executed server-side (the caller never sees the difference). */
export type ToolType = "http" | "cli" | "mcp";
/** A named credentialed instance of a tool; secret values live in the store, not here. */
export interface ToolConnection { label: string; description?: string }
/** One parameter of a tool action. */
export interface ToolParam { name: string; required: boolean }
/** HTTP request shape for an `http`-type action. */
export interface HttpAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown }
/** One callable action; executor-specific fields vary by tool `type`. */
export interface ToolAction { description?: string; params?: ToolParam[]; http?: HttpAction; command?: string; remote_tool?: string }
/** A vault tool: one manifest, one or more connections, one `invoke` door regardless of executor. */
export interface ToolManifest {
  id: string; name: string; type: ToolType; description: string;
  runtime?: "host" | "container";
  requires?: string[];
  connections?: ToolConnection[];
  actions: Record<string, ToolAction>;
  source?: { repo?: string; package?: string; ref?: string };
  install?: string[];
  bin?: string;
  materialize?: { inject: "env" | "profile"; env?: Record<string,string>; profile?: { restore: string; into: string } };
  transport?: { kind: "stdio" | "http"; command?: string; url?: string; ref?: string };
  body?: string;
}

const ID_RE = /^[a-z0-9-]+$/;

/** Reads and parses `tools/<id>/TOOL.md` (YAML frontmatter + markdown body); rejects unsafe ids. */
export async function loadTool(root: string, id: string): Promise<ToolManifest> {
  if (!ID_RE.test(id)) throw new Error(`invalid tool id: ${id}`);
  const raw = await readFile(join(root, "tools", id, "TOOL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`tool ${id}: missing frontmatter`);
  const fm = (parseYaml(m[1]) ?? {}) as Partial<ToolManifest>;
  if (!fm.type || !fm.actions) throw new Error(`tool ${id}: frontmatter needs type + actions`);
  return { ...fm, id, name: fm.name ?? id, description: fm.description ?? "", type: fm.type, actions: fm.actions, body: m[2] || undefined } as ToolManifest;
}

/** Lists tool ids = directory names under `tools/`. */
export async function listToolIds(root: string): Promise<string[]> {
  try { return (await readdir(join(root, "tools"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

/** Replaces `${params.key}` and `${conn.key}` placeholders, throwing if any reference is unresolved. */
export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; conn: Record<string, string> }): string {
  return input.replace(/\$\{(params|conn)\.([\w-]+)\}/g, (_m, ns: string, k: string) => {
    const v = ns === "params" ? ctx.params[k] : ctx.conn[k];
    if (v === undefined || v === null) throw new Error(`unresolved template reference: \${${ns}.${k}}`);
    return String(v);
  });
}

/** The flat secret-store ref for one connection's one secret key. */
export function connRef(tool: string, label: string, key: string): string { return `${tool}__${label}__${key}`; }

/** Picks the connection label to use: explicit (must be valid), the lone default, or throws if ambiguous. */
export function resolveConnection(connections: ToolConnection[], requested: string | undefined): string | undefined {
  if (requested !== undefined) {
    if (!connections.some((c) => c.label === requested)) throw new Error(`'${requested}' is not a connection of this tool; available: ${connections.map((c) => c.label).join(", ") || "(none)"}`);
    return requested;
  }
  if (connections.length === 1) return connections[0].label;
  if (connections.length === 0) return undefined;
  throw new Error(`specify a connection: ${connections.map((c) => c.label).join(", ")}`);
}
```

- [ ] **Step 5: run it — expect PASS, then commit**

Run: `npx vitest run test/tools.test.ts` → PASS.
```bash
git add package.json package-lock.json src/tools.ts test/tools.test.ts
git commit -m "feat(tools): TOOL.md manifest model, loader, connection resolution"
```

---

## Phase 2 — connection bundle helpers (TDD)

### Task 2: load + status helpers over the secret store

**Files:** Modify `src/tools.ts`; Create `test/toolConnections.test.ts`.

- [ ] **Step 1: write the failing test**

Create `test/toolConnections.test.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { createSecretStore, loadOrCreateKey } from "../src/secrets.js";
import { loadConnBundle, connectionConfigured } from "../src/tools.js";

function store() { const dir = mkdtempSync(join(tmpdir(), "geode-sec-")); return createSecretStore({ dir, key: loadOrCreateKey(dir) }); }

test("connectionConfigured true only when all requires keys are present", async () => {
  const s = store();
  expect(await connectionConfigured(s, "gmail", "acme-sales", ["TOKEN"])).toBe(false);
  await s.set("gmail__acme-sales__TOKEN", "abc");
  expect(await connectionConfigured(s, "gmail", "acme-sales", ["TOKEN"])).toBe(true);
});

test("loadConnBundle returns the values, throws on a missing required key", async () => {
  const s = store();
  await s.set("gmail__acme-sales__TOKEN", "abc");
  expect(await loadConnBundle(s, "gmail", "acme-sales", ["TOKEN"])).toEqual({ TOKEN: "abc" });
  await expect(loadConnBundle(s, "gmail", "acme-sales", ["NADA"])).rejects.toThrow(/needs setup/);
});
```

- [ ] **Step 2: run — expect FAIL** (`npx vitest run test/toolConnections.test.ts`).

- [ ] **Step 3: add helpers to `src/tools.ts`** (append; add the import)

At the top, add: `import type { SecretStore } from "./secrets.js";`
Append:
```ts
/** Resolves all `requires` secret keys for one connection into a `${conn.X}` map; throws if any is unset. */
export async function loadConnBundle(store: Pick<SecretStore, "get">, tool: string, label: string | undefined, requires: string[]): Promise<Record<string, string>> {
  const conn: Record<string, string> = {};
  for (const key of requires) {
    const v = label === undefined ? null : await store.get(connRef(tool, label, key));
    if (v === null) throw new Error(`connection '${label ?? "(none)"}' needs setup for ${tool}: missing ${key}`);
    conn[key] = v;
  }
  return conn;
}

/** True when every `requires` key for a connection has a stored value. */
export async function connectionConfigured(store: Pick<SecretStore, "get">, tool: string, label: string, requires: string[]): Promise<boolean> {
  for (const key of requires) if ((await store.get(connRef(tool, label, key))) === null) return false;
  return true;
}
```

- [ ] **Step 4: run — expect PASS; commit**
```bash
git add src/tools.ts test/toolConnections.test.ts
git commit -m "feat(tools): per-connection bundle load + configured status helpers"
```

---

## Phase 3 — `invoke.ts` onto tools + dispatch (TDD)

### Task 3: rewrite invoke

**Files:** Modify `src/invoke.ts`, `test/invoke.test.ts`; Modify callers `src/server.ts`, `src/toolCatalog.ts`, `src/dashboard/api.ts` (invoke call only), `src/dashboard/index.ts`.

- [ ] **Step 1: rewrite `test/invoke.test.ts`** (replace the file)

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { invoke } from "../src/invoke.js";

function vaultWith(id: string, md: string): string {
  const root = mkdtempSync(join(tmpdir(), "geode-inv-"));
  mkdirSync(join(root, "tools", id), { recursive: true });
  writeFileSync(join(root, "tools", id, "TOOL.md"), md);
  return root;
}
const fakeSecrets = (m: Record<string, string>) => ({ get: async (r: string) => m[r] ?? null });

const HTTP = `---
id: demo
name: Demo
type: http
description: d
requires: [API_KEY]
connections: [{ label: default }]
actions:
  ping:
    http: { method: GET, url: "https://example.test/p", headers: { X-Key: "\${conn.API_KEY}" } }
---
`;
const CLI = `---
id: cli1
name: Cli
type: cli
description: d
connections: [{ label: default }]
actions: { run: { command: "go" } }
---
`;

test("http invoke resolves conn + params and returns status/body", async () => {
  const root = vaultWith("demo", HTTP);
  let seenHeader = "";
  const fetchFn = (async (_url: string, init: any) => { seenHeader = init.headers["X-Key"]; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  const r = await invoke({ root, secrets: fakeSecrets({ "demo__default__API_KEY": "sek" }), fetchFn }, { tool: "demo", action: "ping" });
  expect(seenHeader).toBe("sek");
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ ok: true });
});

test("invalid connection + needs-setup errors", async () => {
  const root = vaultWith("demo", HTTP);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "demo", action: "ping", connection: "nope" })).rejects.toThrow(/not a connection/);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "demo", action: "ping" })).rejects.toThrow(/needs setup/);
});

test("cli/mcp executors are inert in 2a", async () => {
  const root = vaultWith("cli1", CLI);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "cli1", action: "run" })).rejects.toThrow(/executor 'cli' not available yet/);
});

test("unknown tool + action errors", async () => {
  const root = vaultWith("demo", HTTP);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "ghost", action: "x" })).rejects.toThrow(/unknown tool/);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "demo", action: "nope" })).rejects.toThrow(/unknown action/);
});
```

- [ ] **Step 2: run — expect FAIL** (`npx vitest run test/invoke.test.ts`).

- [ ] **Step 3: rewrite `src/invoke.ts`**

```ts
import type { SecretStore } from "./secrets.js";
import { loadTool, resolveTemplate, resolveConnection, loadConnBundle } from "./tools.js";

/** Arguments to call a single tool action by name, optionally selecting a connection. */
export interface InvokeArgs { tool: string; action: string; params?: Record<string, unknown>; connection?: string; workspace?: string }
/** HTTP status code and parsed (or raw text) response body returned from a tool action call. */
export interface InvokeResult { status: number; body: unknown }

/** Loads the tool manifest, resolves the connection bundle, and dispatches the action by executor type. */
export async function invoke(
  deps: { root: string; secrets: Pick<SecretStore, "get">; fetchFn?: typeof fetch },
  args: InvokeArgs,
): Promise<InvokeResult> {
  const manifest = await loadTool(deps.root, args.tool).catch(() => { throw new Error(`unknown tool: ${args.tool}`); });
  const action = manifest.actions[args.action];
  if (!action) throw new Error(`unknown action "${args.action}" on tool "${args.tool}"`);
  const label = resolveConnection(manifest.connections ?? [], args.connection);
  const conn = await loadConnBundle(deps.secrets, args.tool, label, manifest.requires ?? []);
  const params = args.params ?? {};
  if (manifest.type === "cli" || manifest.type === "mcp") throw new Error(`executor '${manifest.type}' not available yet (slice #3)`);
  const http = action.http;
  if (!http) throw new Error(`action "${args.action}" has no http definition`);
  const ctx = { params, conn };
  const url = resolveTemplate(http.url, ctx);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(http.headers ?? {})) headers[k] = resolveTemplate(v, ctx);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(http.query ?? {})) q.set(k, resolveTemplate(v, ctx));
  const qs = q.toString();
  const body = http.body === undefined ? undefined : typeof http.body === "string" ? resolveTemplate(http.body, ctx) : JSON.stringify(http.body);
  const resp = await (deps.fetchFn ?? fetch)(qs ? `${url}?${qs}` : url, { method: http.method, headers, body });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: resp.status, body: parsed };
}
```

- [ ] **Step 4: update the invoke callers to the new arg shape (keep build green)**

`src/server.ts` — the invoke tool registration (currently `inputSchema: { integration: z.string(), action: z.string(), params: ..., workspace: ... }`). Change to:
```ts
      inputSchema: { tool: z.string(), action: z.string(), connection: z.string().optional(), params: z.record(z.string(), z.any()).optional(), workspace: z.string().optional() },
```
`src/toolCatalog.ts` — the `invoke` entry `params` and `description`. Replace the `invoke` object's `params` with:
```ts
    params: [
      { name: "tool", type: "string", required: true },
      { name: "action", type: "string", required: true },
      { name: "connection", type: "string", required: false },
      { name: "params", type: "object", required: false },
    ],
```
and its `description` with:
```ts
    description:
      "Run one action of a tool in your Geode vault — you (the caller) execute it; the server injects the chosen connection's secret. First ask `query` for the plan (or read the tool's TOOL.md) to learn the action + params + which connection.",
```
`src/dashboard/api.ts` — the `/integrations/:name/test` handler's invoke call (keep the route name for now; rename in Phase 5). Change `deps.invoke({ integration: req.params.name, ... })` to:
```ts
    try { res.json(await deps.invoke({ tool: req.params.name, action: String(req.body?.action ?? ""), connection: req.body?.connection, params: req.body?.params ?? {} })); }
```
`src/dashboard/index.ts` — the `invoke:` dep is `(args) => invoke({ root: workspace.root, secrets }, args)`; its type now flows from `InvokeArgs`. No code change needed unless a type annotation names `integration` — search and update if present.

- [ ] **Step 5: run invoke tests + typecheck — expect PASS/clean; commit**

Run: `npx vitest run test/invoke.test.ts` → PASS. Run: `npm run typecheck` → clean.
```bash
git add src/invoke.ts test/invoke.test.ts src/server.ts src/toolCatalog.ts src/dashboard/api.ts src/dashboard/index.ts
git commit -m "feat(invoke): dispatch by executor type over tools + connections"
```

---

## Phase 4 — `capabilities.ts` onto tools (TDD)

### Task 4: derive capabilities from `tools/`

**Files:** Modify `src/capabilities.ts`, `test/capabilities.test.ts`, `src/server.ts`, `src/dashboard/api.ts`.

- [ ] **Step 1: rewrite `test/capabilities.test.ts`** (replace)

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { parseFrontmatter, deriveCapabilities } from "../src/capabilities.js";
import { createSecretStore, loadOrCreateKey } from "../src/secrets.js";

function vault() { return mkdtempSync(join(tmpdir(), "geode-cap-")); }
function store(dir: string) { return createSecretStore({ dir: join(dir, ".s"), key: loadOrCreateKey(join(dir, ".s")) }); }
function tool(root: string, id: string, md: string) { mkdirSync(join(root, "tools", id), { recursive: true }); writeFileSync(join(root, "tools", id, "TOOL.md"), md); }

const TOOL = `---
id: linear
name: Linear
type: http
description: Issues.
requires: [API_KEY]
connections: [{ label: default }]
actions: { create_issue: { http: { method: POST, url: "x" } } }
---
`;

test("parseFrontmatter still reads flat OKF fields", () => {
  expect(parseFrontmatter("---\ntype: sop\ntitle: T\n---\nx").type).toBe("sop");
});

test("deriveCapabilities lists tools (with connection status) and recipes", async () => {
  const root = vault(); tool(root, "linear", TOOL);
  writeFileSync(join(root, "r.md"), "---\ntype: sop\ntitle: Deploy\ndescription: how\n---\nbody");
  const s = store(root);
  const caps = await deriveCapabilities(root, s);
  expect(caps.tools[0].id).toBe("linear");
  expect(caps.tools[0].actions).toEqual(["create_issue"]);
  expect(caps.tools[0].connections[0]).toEqual({ label: "default", configured: false });
  await s.set("linear__default__API_KEY", "k");
  expect((await deriveCapabilities(root, s)).tools[0].connections[0].configured).toBe(true);
  expect(caps.recipes.map((r) => r.title)).toContain("Deploy");
});

test("deriveCapabilities on an empty vault returns empty lists", async () => {
  const root = vault();
  const caps = await deriveCapabilities(root, store(root));
  expect(caps.tools).toEqual([]); expect(caps.recipes).toEqual([]);
});
```

- [ ] **Step 2: run — expect FAIL.**

- [ ] **Step 3: rewrite `src/capabilities.ts`** — keep `parseFrontmatter` and `walkMd` (change its excluded dir from `integrations` to `tools`), replace the integrations logic with tools:

Replace the `CapabilitySummary` interface, the `walkMd` exclusion line, and `deriveCapabilities`:
```ts
import type { SecretStore } from "./secrets.js";
import { listToolIds, loadTool, connectionConfigured } from "./tools.js";
// ... keep Frontmatter interface + parseFrontmatter unchanged ...

/** Aggregated summary of a vault's tools and recipes/skills. */
export interface CapabilitySummary {
  tools: { id: string; name: string; type: string; description: string; connections: { label: string; configured: boolean }[]; actions: string[] }[];
  recipes: { title: string; description: string; path: string }[];
  text: string;
}
```
In `walkMd`, change the skip condition `e.name === "integrations"` to `e.name === "tools"`.
Replace `deriveCapabilities`:
```ts
/** Scans a vault root to summarise its tools (with connection status) and Markdown recipes/skills. */
export async function deriveCapabilities(root: string, secrets: Pick<SecretStore, "get">): Promise<CapabilitySummary> {
  const tools: CapabilitySummary["tools"] = [];
  for (const id of (await listToolIds(root)).sort()) {
    try {
      const m = await loadTool(root, id);
      const connections = [];
      for (const c of m.connections ?? []) connections.push({ label: c.label, configured: await connectionConfigured(secrets, m.id, c.label, m.requires ?? []) });
      tools.push({ id: m.id, name: m.name, type: m.type, description: m.description, connections, actions: Object.keys(m.actions) });
    } catch { /* skip malformed */ }
  }
  const recipes: CapabilitySummary["recipes"] = [];
  const files: string[] = [];
  await walkMd(root, files);
  for (const f of files) {
    const fm = parseFrontmatter(await readFile(f, "utf8").catch(() => ""));
    if (fm.type && RECIPE_TYPES.has(fm.type)) recipes.push({ title: fm.title ?? f, description: fm.description ?? "", path: f.slice(root.length + 1) });
  }
  const lines: string[] = ["# Capabilities", "\n## Recipes & skills"];
  lines.push(recipes.length ? recipes.map((r) => `- ${r.title} — ${r.description} (${r.path})`).join("\n") : "(nothing yet)");
  lines.push("\n## Tools");
  lines.push(tools.length ? tools.map((t) => `- ${t.id} [${t.type}] — ${t.description} · connections: ${t.connections.map((c) => `${c.label}(${c.configured ? "ok" : "needs setup"})`).join(", ") || "—"} · actions: ${t.actions.join(", ")}`).join("\n") : "(nothing yet)");
  return { tools, recipes, text: lines.join("\n") };
}
```

- [ ] **Step 4: update callers to pass secrets**

`src/server.ts` `makeListCapabilitiesHandler({ root: ..., derive: deriveCapabilities })` — the handler currently calls `derive(root)`. Change the `ListCapabilitiesHandlerDeps.derive` type + call to pass secrets. Simplest: in `buildMcpServer`, where `opts?.secrets` exists, wire `derive: (root) => deriveCapabilities(root, secrets)`. Update `makeListCapabilitiesHandler` deps `derive: (root: string) => Promise<{ text: string }>` stays; change the registration to:
```ts
  const listCapabilitiesHandler = makeListCapabilitiesHandler({ root: queryDeps.workspace.root, derive: (root) => deriveCapabilities(root, opts?.secrets ?? { get: async () => null }) });
```
`src/dashboard/api.ts` `/capabilities` route: `res.json(await deriveCapabilities(deps.workspace.root, deps.secrets));`

- [ ] **Step 5: run capabilities tests + typecheck — PASS/clean; commit**
```bash
git add src/capabilities.ts test/capabilities.test.ts src/server.ts src/dashboard/api.ts
git commit -m "feat(capabilities): derive from tools/ with connection status"
```

---

## Phase 5 — dashboard backend + example + constitution

### Task 5: dashboard ops/api/knowledge → tools

**Files:** Modify `src/dashboard/ops.ts`, `src/dashboard/api.ts`, `src/dashboard/knowledge.ts`, `src/constitution.ts`; rename `examples/integrations/httpbin/manifest.json` → `examples/tools/httpbin/TOOL.md`; update `test/dashboard/api-ops.test.ts` (and any dashboard test referencing integrations).

- [ ] **Step 1: rewrite `src/dashboard/ops.ts`** integrations parts → tools

Replace the `IntegrationView`/`toView`/`listIntegrations`/`getIntegration`/`listSecrets` block with:
```ts
import { type SecretStore } from "../secrets.js";
import { listToolIds, loadTool, connectionConfigured, type ToolManifest } from "../tools.js";

/** Flattened dashboard view of a tool with per-connection configured status. */
export interface ToolView {
  id: string; name: string; type: string; description: string;
  actions: { name: string; description?: string }[];
  connections: { label: string; description?: string; configured: boolean }[];
  requires: string[];
}

async function toView(m: ToolManifest, secrets: Pick<SecretStore, "get">): Promise<ToolView> {
  const connections = [];
  for (const c of m.connections ?? []) connections.push({ label: c.label, description: c.description, configured: await connectionConfigured(secrets, m.id, c.label, m.requires ?? []) });
  return { id: m.id, name: m.name, type: m.type, description: m.description, actions: Object.entries(m.actions).map(([name, a]) => ({ name, description: a.description })), connections, requires: m.requires ?? [] };
}

/** Reads all tools under <root>/tools and returns their views with connection status. */
export async function listTools(root: string, secrets: Pick<SecretStore, "get">): Promise<ToolView[]> {
  const out: ToolView[] = [];
  for (const id of (await listToolIds(root)).sort()) { try { out.push(await toView(await loadTool(root, id), secrets)); } catch { /* skip malformed */ } }
  return out;
}

/** Loads a single tool by id and returns its view. */
export async function getTool(root: string, id: string, secrets: Pick<SecretStore, "get">): Promise<ToolView> {
  return toView(await loadTool(root, id), secrets);
}

/** Lists stored secret refs, annotating each with the tool id it belongs to (the part before the first `__`). */
export async function listSecrets(_root: string, secrets: Pick<SecretStore, "list">): Promise<{ ref: string; requiredBy: string[] }[]> {
  return (await secrets.list()).map((ref) => ({ ref, requiredBy: ref.includes("__") ? [ref.split("__")[0]] : [] }));
}
```
Keep `listArtifacts` unchanged.

- [ ] **Step 2: update `src/dashboard/api.ts` routes**

Replace the three `/integrations*` routes with:
```ts
  router.get("/tools", async (_req, res) => { res.json(await listTools(deps.workspace.root, deps.secrets)); });
  router.get("/tools/:id", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { res.json(await getTool(deps.workspace.root, req.params.id, deps.secrets)); }
    catch { res.status(404).json({ error: "unknown tool" }); }
  });
  router.post("/tools/:id/test", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { res.json(await deps.invoke({ tool: req.params.id, action: String(req.body?.action ?? ""), connection: req.body?.connection, params: req.body?.params ?? {} })); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
```
Update the import line from `ops.js` to `{ listTools, getTool, listSecrets, listArtifacts }`. (`deps.secrets` must satisfy `Pick<SecretStore,"get"|"list">` — it does.)

- [ ] **Step 3: `src/dashboard/knowledge.ts`** — change the excluded directory name from `integrations` to `tools` (find the literal `"integrations"` in its skip set and replace with `"tools"`).

- [ ] **Step 4: `src/constitution.ts`** — replace the sentence referencing integrations. Find: `read its integrations/<name>/manifest.json and return the exact ordered invoke(integration, action, params) calls` → replace with: `read its tools/<id>/TOOL.md and return the exact ordered invoke(tool, action, params, connection) calls`.

- [ ] **Step 5: move the example** → `examples/tools/httpbin/TOOL.md`:
```bash
mkdir -p examples/tools/httpbin && git rm examples/integrations/httpbin/manifest.json
```
Create `examples/tools/httpbin/TOOL.md`:
```markdown
---
id: httpbin
name: httpbin
type: http
description: Sample HTTP tool against httpbin.org — demonstrates server-side per-connection secret injection. Copy into <vault>/tools/httpbin/ to try invoke.
requires: [DEMO_KEY]
connections:
  - { label: default, description: "the demo account" }
actions:
  headers:
    description: Echoes request headers back; the injected X-Demo proves the broker supplied DEMO_KEY server-side.
    http:
      method: GET
      url: https://httpbin.org/headers
      headers: { X-Demo: "Bearer ${conn.DEMO_KEY}" }
---
Set the secret with: `npm run secret -- set httpbin__default__DEMO_KEY`
```

- [ ] **Step 6: update dashboard tests** — in `test/dashboard/api-ops.test.ts`, the integration test posts to `/api/integrations/demo/test`; create a `tools/demo/TOOL.md` fixture and post to `/api/tools/demo/test` with `{ action, connection, params }`. (Inspect the existing test; mirror its setup with a `tools/` fixture and the renamed route. If it asserts `listIntegrations`-shaped data, switch to `listTools`/`ToolView`.) Also update `test/workspace.dashboard.test.ts:59` (`integrations/x/manifest.json` traversal assertion) to `tools/x/TOOL.md` if it asserts a path policy.

- [ ] **Step 7: typecheck + targeted tests + commit**

Run: `npm run typecheck` → clean. Run: `npx vitest run test/dashboard` → PASS.
```bash
git add src/dashboard/ops.ts src/dashboard/api.ts src/dashboard/knowledge.ts src/constitution.ts examples/ test/dashboard test/workspace.dashboard.test.ts
git commit -m "feat(dashboard): tools backend (listTools/getTool, /api/tools routes)"
```

---

## Phase 6 — frontend → Tools

### Task 6: migrate the React dashboard

**Files:** Modify `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/TopBar.tsx`, `web/src/views/Capabilities.tsx`, `web/src/views/Secrets.tsx`; rename `web/src/views/Integrations.tsx` → `web/src/views/Tools.tsx`.

- [ ] **Step 1: `web/src/api.ts`** — replace the `IntegrationView` type (line 4), the `capabilities` return type (line 61), and the integration helpers (lines 62-64) with:
```ts
/** Describes a tool: its actions and per-connection configured status. */
export interface ToolView { id: string; name: string; type: string; description: string; actions: { name: string; description?: string }[]; connections: { label: string; description?: string; configured: boolean }[]; requires: string[] }
```
```ts
  capabilities: () => json<{ tools: { id: string; name: string; type: string; description: string; connections: { label: string; configured: boolean }[]; actions: string[] }[]; recipes: { title: string; description: string; path: string }[] }>("/api/capabilities"),
  tools: () => json<ToolView[]>("/api/tools"),
  tool: (id: string) => json<ToolView>(`/api/tools/${encodeURIComponent(id)}`),
  testAction: (id: string, action: string, params: Record<string, unknown>) => json<{ status: number; body: unknown }>(`/api/tools/${encodeURIComponent(id)}/test`, { method: "POST", body: JSON.stringify({ action, params }) }),
```

- [ ] **Step 2: rename + rewrite the view** — `git mv web/src/views/Integrations.tsx web/src/views/Tools.tsx`, then replace its contents:
```tsx
import { useEffect, useState } from "react";
import { api, type ToolView } from "../api";
/** Renders the Tools view: each tool with its type, connections (configured status) and actions, with a test runner. */
export function Tools() {
  const [list, setList] = useState<ToolView[]>([]);
  const [open, setOpen] = useState<ToolView | null>(null);
  const [result, setResult] = useState<string>("");
  useEffect(() => { api.tools().then(setList).catch(() => setList([])); }, []);
  const test = async (action: string) => {
    setResult("…");
    try { setResult(JSON.stringify(await api.testAction(open!.id, action, {}), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };
  if (open) return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <button className="ghost" onClick={() => { setOpen(null); setResult(""); }}>← Tools</button>
      <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em" }}>{open.name} <span className="chip">{open.type}</span></h2>
      <p style={{ color: "var(--muted)" }}>{open.description}</p>
      <div className="eyebrow" style={{ marginTop: 16 }}>Actions</div>
      {open.actions.map((a) => (
        <div key={a.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{a.name}</span>
          <button className="btn sm" onClick={() => test(a.name)}>Test</button>
        </div>
      ))}
      {result && <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10 }}>{result}</pre>}
      <div className="eyebrow" style={{ marginTop: 16 }}>Connections</div>
      {open.connections.length === 0 && <p style={{ color: "var(--faint)" }}>No connections.</p>}
      {open.connections.map((c) => (
        <div key={c.label} className="card" style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{c.label}{c.description ? ` — ${c.description}` : ""}</span>
          <span className="chip" style={c.configured ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>{c.configured ? "configured" : "needs setup"}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Tools</div>
      {list.length === 0 && <p style={{ color: "var(--faint)" }}>No tools yet.</p>}
      {list.map((t) => (
        <div key={t.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, cursor: "pointer" }} onClick={() => setOpen(t)}>
          <strong style={{ flex: 1 }}>{t.id} <span className="chip">{t.type}</span></strong>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{t.connections.filter((c) => c.configured).length}/{t.connections.length} connections</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `web/src/App.tsx`** — line 9 import `{ Tools } from "./views/Tools"`; line 20 `api.integrations()` → `api.tools()`; line 32 `{view === "Integrations" && <Integrations />}` → `{view === "Tools" && <Tools />}`.

- [ ] **Step 4: `web/src/components/TopBar.tsx`** — line 5 `VIEWS` tuple: replace the literal `"Integrations"` with `"Tools"`.

- [ ] **Step 5: `web/src/views/Capabilities.tsx`** — lines 6/10/11/12/14/15: `cap.integrations` → `cap.tools`; the fallback `{ integrations: [], recipes: [] }` → `{ tools: [], recipes: [] }`; eyebrow label `Integrations` → `Tools`; `No integrations yet.` → `No tools yet.`; render `{t.id}`/`{t.type}` and `t.actions.join(" · ")` (the capabilities `tools[].actions` is `string[]`). Replace the block:
```tsx
      <div className="eyebrow">Tools</div>
      {cap.tools.length === 0 && <p style={{ color: "var(--faint)" }}>No tools yet.</p>}
      {cap.tools.map((t) => (
        <div key={t.id} className="card" style={{ display: "block", marginBottom: 10 }}>
          <strong>{t.id}</strong> <span className="chip">{t.type}</span> <span style={{ color: "var(--muted)" }}>— {t.description}</span>
          <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 12, color: "var(--emerald-300)", marginTop: 4 }}>{t.actions.join(" · ")}</div>
        </div>
      ))}
```

- [ ] **Step 6: `web/src/views/Secrets.tsx`** — refs are now composite (e.g. `httpbin__default__DEMO_KEY`). The add-secret validation `/^[A-Za-z0-9_-]+$/` already allows this. Update only the placeholder (line 36) to guide the format: `placeholder="<tool>__<connection>__<KEY> (e.g. httpbin__default__DEMO_KEY)"`. No logic change.

- [ ] **Step 7: build the frontend + commit**

Run: `cd web && npm install && npm run build` (or the repo's web build script) → succeeds (no TS errors, bundle written to `web/dist`).
```bash
git add web/src
git commit -m "feat(web): Tools dashboard view + /api/tools client; composite secret refs"
```

---

## Phase 7 — remove the old model + verify

### Task 7: delete `integrations.ts`, old example, update docs

**Files:** Delete `src/integrations.ts`, `test/integrations.test.ts`; update `test/e2e.manual.md`, `test/dashboard.e2e.manual.md`.

- [ ] **Step 1: confirm no live references remain**

Run: `grep -rn "integrations.js\|loadIntegration\|IntegrationManifest\|IntegrationView\|/api/integrations\|examples/integrations" src web test` → expect **no hits in `src/` or `web/src/`** (only manual-doc text may remain, fixed next). If a hit remains, fix it before deleting.

- [ ] **Step 2: delete the dead files**
```bash
git rm src/integrations.ts test/integrations.test.ts
```
(`test/tools.test.ts` replaced its coverage in Phase 1.)

- [ ] **Step 3: update the manual e2e docs** — in `test/e2e.manual.md` and `test/dashboard.e2e.manual.md`, replace the `integrations/*/manifest.json` instructions with the new layout: copy `examples/tools/httpbin/TOOL.md` into `$GEODE_WORKSPACE/tools/httpbin/TOOL.md`, set the secret `httpbin__default__DEMO_KEY`, and the agent reads `tools/httpbin/TOOL.md`. (Update the literal paths + the secret name + the "Integrations" → "Tools" dashboard label references.)

- [ ] **Step 4: full verification**

Run: `npm run typecheck` → clean.
Run: `npm run lint` → clean (JSDoc gate).
Run: `npm test` → all green (the new `tools`/`toolConnections`/`invoke`/`capabilities`/dashboard suites + every pre-existing suite).
Run: `cd web && npm run build` → succeeds.

- [ ] **Step 5: commit**
```bash
git add -A
git commit -m "refactor: remove the legacy integrations model (replaced by tools/)"
```

---

## Self-review notes

- **Spec coverage:** `TOOL.md` schema all 3 types (T1) ✓; credential bundles — implemented as composite refs `<tool>__<label>__<KEY>` over the existing store (T2, spec-refinement noted in plan header) ✓; `runtime` declared+typed field (T1 `ToolManifest.runtime`) ✓; `list_capabilities`/`invoke` resolution incl. connection rules + dispatch + inert cli/mcp (T3/T4) ✓; migration of sample + all readers + dashboard backend + **frontend** (T5/T6) ✓; old path removed (T7) ✓. Success criteria 1–5 → T4/T3/T5/T6/T7.
- **Spec refinement recorded:** the store stays flat; per-connection bundles are composite refs (cleaner, reuses the secret-link flow). The `blobs`/profile-dir variant remains a #3 concern (cli executor), unimplemented here — consistent with "cli not runnable in 2a".
- **Green between phases:** invoke arg-shape change (P3) updates server/toolCatalog/dashboard-invoke-call together; route rename (P5) precedes the frontend (P6) but the dashboard remains buildable because `/api/tools` + the frontend land before the old `integrations.ts` is deleted (P7).
- **Out of scope (correctly absent):** running cli/mcp, OAuth, container enforcement, the agent-core/install-SOP (2b), new "add a tool" UI.

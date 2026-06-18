# v1 Refinements (Increment 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refactor the existing kernel + context-tools to the final v1 model: rename `delegate`→`query`, remove `find`, derive `list_capabilities` from OKF frontmatter + integration manifests, and update seeding + the constitution to OKF — all behavior-preserving where possible, with the full suite staying green.

**Architecture:** Pure refactor of merged code (no new product capability). The agentic tool is renamed (`query`); the mechanical `find` tool is removed (all context access goes through `query`). `list_capabilities` stops reading a hand-maintained `capabilities.md` and instead computes the menu from `integrations/*/manifest.json` + OKF-frontmatter'd concept files. Seeding + constitution adopt OKF.

**Tech Stack:** Existing kernel stack — Node/TypeScript (NodeNext ESM), `@modelcontextprotocol/sdk` v1, `zod`, `vitest`. No new deps.

---

## Reused context (do not re-derive)
- Built tools today: `find`, `delegate`, `remember`, `list_capabilities` (on `main`). `delegate` is a full agent run; `remember` wraps `delegate`; `list_capabilities` reads `capabilities.md`; `find` is a mechanical read/list/search MCP tool. Tests pass (41).
- Test imports use `.js` extensions on `.ts` sources (NodeNext ESM).
- The agent (Claude Agent SDK) has its OWN Read/Grep/Glob/Bash — our `find` was only a caller-facing convenience, safe to remove.

## File Structure
| File | Change |
|---|---|
| `src/delegate.ts` → `src/query.ts` | rename file + symbols (`delegate`→`query`, `DelegateDeps`→`QueryDeps`, `DelegateResult`→`QueryResult`) |
| `src/ingest.ts` | `remember` imports/wraps `query` (was `delegate`) |
| `src/find.ts`, `test/find.test.ts` | **delete** |
| `src/capabilities.ts` | replace `listCapabilities` with `deriveCapabilities` + `parseFrontmatter` |
| `src/seed.ts` | OKF frontmatter on `AGENTS.md`/`index.md`; drop `capabilities.md` scaffold |
| `src/constitution.ts` | OKF + "never execute / return invoke-plans / never call integrations"; drop "update capabilities.md" |
| `src/server.ts` | rename `makeDelegateHandler`→`makeQueryHandler`; tool `delegate`→`query` (new description); remove `find` registration + `makeFindHandler`; `list_capabilities` handler uses `deriveCapabilities` |
| `src/index.ts` | rename refs |
| tests | `delegate.test.ts`→`query.test.ts`; update `ingest`/`server`/`capabilities`/`seed`/`constitution` tests; remove `find` test |

---

## Task 1: Rename `delegate` → `query`

**Files:** `git mv src/delegate.ts src/query.ts`; `git mv test/delegate.test.ts test/query.test.ts`; modify `src/ingest.ts`, `src/server.ts`, `src/index.ts`, and the affected tests.

- [ ] **Step 1: Rename the module + symbols**
  - `git mv src/delegate.ts src/query.ts` and `git mv test/delegate.test.ts test/query.test.ts`.
  - In `src/query.ts`: rename `export async function delegate` → `query`; `DelegateDeps` → `QueryDeps`; `DelegateResult` → `QueryResult`. Keep the body identical (run-manager flow, git, event log). Internal commit messages stay `delegate run-…`? No — change to `query run-…` for consistency (update the matching `delegate.test.ts`/`query.test.ts` assertions accordingly).
- [ ] **Step 2: Update consumers**
  - `src/ingest.ts`: import `{ query, QueryDeps, QueryResult }` from `./query.js`; `remember` calls `query(...)`; rename the `DelegateDeps` type usage to `QueryDeps`.
  - `src/server.ts`: `import { query, QueryDeps, QueryResult } from "./query.js"`; rename `DelegateHandlerDeps`→`QueryHandlerDeps`, `makeDelegateHandler`→`makeQueryHandler`, `runDelegate`→`runQuery`, and the shared `runAgenticTool` label `"delegate"`→`"query"`.
  - `src/index.ts`: rename `delegateDeps`→`queryDeps` (type `QueryDeps`); pass to `buildMcpServer`.
- [ ] **Step 3: Re-point the tool registration** — in `buildMcpServer`, register tool **`query`** (was `delegate`) with description: *"Ask your Geode vault — it searches your context, recipes and SOPs and returns a synthesized answer, OR an executable plan (the exact `invoke` calls to run). It prepares; you execute via `invoke`."* `inputSchema: { instruction: z.string(), workspace: z.string().optional() }`. `remember`'s wiring becomes `runRemember: (args, op) => remember(queryDeps, args, op)`.
- [ ] **Step 4: Update tests** — in `test/query.test.ts` (renamed), `test/ingest.test.ts`, `test/server.test.ts`: replace `delegate`/`DelegateDeps`/`makeDelegateHandler`/`runDelegate` with the `query` equivalents; update commit-message assertions (`commit:delegate run-1: …` → `commit:query run-1: …`) and the error-label assertion (`delegate failed` → `query failed`).
- [ ] **Step 5: Run + commit**
  - Run: `npm test` → all pass. Run `npx tsc --noEmit` → clean.
  - `git add -A && git commit -m "refactor: rename delegate -> query (vault researches/plans, never executes)"`

## Task 2: Remove the `find` tool

**Files:** delete `src/find.ts`, `test/find.test.ts`; modify `src/server.ts`.

- [ ] **Step 1: Delete** `src/find.ts` and `test/find.test.ts` (`git rm`).
- [ ] **Step 2: Unregister** in `src/server.ts`: remove the `find` import, `FindHandlerDeps`, `makeFindHandler`, and the `server.registerTool("find", …)` block. (Leave `query`/`remember`/`list_capabilities` registrations.)
- [ ] **Step 3: Remove find tests** from `test/server.test.ts` (the `makeFindHandler` test).
- [ ] **Step 4: Run + commit**
  - Run: `npm test` (find tests gone, rest green); `npx tsc --noEmit` clean.
  - `git rm src/find.ts test/find.test.ts && git add -A && git commit -m "refactor: remove the find tool (all context access goes through query)"`

## Task 3: OKF — `parseFrontmatter` + `deriveCapabilities`

**Files:** modify `src/capabilities.ts`, `test/capabilities.test.ts`.

- [ ] **Step 1: Write the failing test** `test/capabilities.test.ts` (replace contents):
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, deriveCapabilities } from "../src/capabilities.js";

test("parseFrontmatter reads YAML frontmatter fields", () => {
  const md = "---\ntype: recipe\ntitle: Bookkeeping\ndescription: Book invoices\ntags: [finance]\n---\nbody";
  const fm = parseFrontmatter(md);
  expect(fm.type).toBe("recipe");
  expect(fm.title).toBe("Bookkeeping");
  expect(fm.description).toBe("Book invoices");
});

test("parseFrontmatter returns empty object when no frontmatter", () => {
  expect(parseFrontmatter("# just a heading")).toEqual({});
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-cap-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("deriveCapabilities lists integrations (from manifests) and recipes (from OKF frontmatter)", async () => {
  mkdirSync(join(root, "integrations", "moneybird"), { recursive: true });
  writeFileSync(join(root, "integrations", "moneybird", "manifest.json"), JSON.stringify({ name: "moneybird", type: "connection", description: "Bookkeeping", requires: ["MONEYBIRD_API_KEY"], actions: { create_invoice: { method: "POST", url: "https://x" } } }));
  mkdirSync(join(root, "recipes"), { recursive: true });
  writeFileSync(join(root, "recipes", "bookkeeping.md"), "---\ntype: recipe\ntitle: Bookkeeping\ndescription: Book invoices from email\n---\nsteps");
  const caps = await deriveCapabilities(root);
  expect(caps.integrations.map((i) => i.name)).toContain("moneybird");
  expect(caps.integrations[0].actions).toContain("create_invoice");
  expect(caps.recipes.map((r) => r.title)).toContain("Bookkeeping");
  expect(caps.text).toContain("moneybird");
  expect(caps.text).toContain("Bookkeeping");
});

test("deriveCapabilities on an empty vault returns empty lists + a friendly note", async () => {
  const caps = await deriveCapabilities(root);
  expect(caps.integrations).toEqual([]);
  expect(caps.recipes).toEqual([]);
  expect(caps.text).toMatch(/nothing yet|no capabilities/i);
});
```

- [ ] **Step 2: Run** `npx vitest run test/capabilities.test.ts` → FAIL (functions not found).
- [ ] **Step 3: Implement** `src/capabilities.ts` (replace contents):
```typescript
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface Frontmatter { type?: string; title?: string; description?: string; tags?: string[] }
export interface CapabilitySummary {
  integrations: { name: string; description: string; actions: string[] }[];
  recipes: { title: string; description: string; path: string }[];
  text: string;
}

const RECIPE_TYPES = new Set(["recipe", "skill", "sop"]);

export function parseFrontmatter(md: string): Frontmatter {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const fm: Frontmatter = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, k, raw] = kv;
    const v = raw.trim();
    if (k === "type") fm.type = v;
    else if (k === "title") fm.title = v;
    else if (k === "description") fm.description = v;
    else if (k === "tags") fm.tags = v.replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return fm;
}

async function walkMd(dir: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "integrations" || e.name === "artifacts") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkMd(full, out);
    else if (e.name.endsWith(".md")) out.push(full);
  }
}

export async function deriveCapabilities(root: string): Promise<CapabilitySummary> {
  // integrations from manifests
  const integrations: CapabilitySummary["integrations"] = [];
  let intDirs: string[] = [];
  try { intDirs = (await readdir(join(root, "integrations"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* none */ }
  for (const name of intDirs) {
    try {
      const m = JSON.parse(await readFile(join(root, "integrations", name, "manifest.json"), "utf8"));
      integrations.push({ name: m.name ?? name, description: m.description ?? "", actions: Object.keys(m.actions ?? {}) });
    } catch { /* skip malformed */ }
  }
  // recipes/skills from OKF frontmatter
  const recipes: CapabilitySummary["recipes"] = [];
  const files: string[] = [];
  await walkMd(root, files);
  for (const f of files) {
    const fm = parseFrontmatter(await readFile(f, "utf8").catch(() => ""));
    if (fm.type && RECIPE_TYPES.has(fm.type)) {
      recipes.push({ title: fm.title ?? f, description: fm.description ?? "", path: f.slice(root.length + 1) });
    }
  }
  const lines: string[] = ["# Capabilities"];
  lines.push("\n## Recipes & skills");
  lines.push(recipes.length ? recipes.map((r) => `- ${r.title} — ${r.description} (${r.path})`).join("\n") : "(nothing yet)");
  lines.push("\n## Integrations");
  lines.push(integrations.length ? integrations.map((i) => `- ${i.name} — ${i.description} · actions: ${i.actions.join(", ")}`).join("\n") : "(nothing yet)");
  return { integrations, recipes, text: lines.join("\n") };
}
```

- [ ] **Step 4: Run** `npx vitest run test/capabilities.test.ts` → PASS (4).
- [ ] **Step 5: Update the server handler** — in `src/server.ts`, `makeListCapabilitiesHandler` now calls `deriveCapabilities(root)` and returns `result.text`. Update the existing server test for `list_capabilities` to stub `derive: async () => ({ integrations: [], recipes: [], text: "# Capabilities\n(nothing yet)" })` (adjust the handler dep shape to `{ root, derive }`). Run `npm test`.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: derive list_capabilities from OKF frontmatter + integration manifests"`

## Task 4: Seeding → OKF (drop capabilities.md)

**Files:** modify `src/seed.ts`, `test/seed.test.ts`.

- [ ] **Step 1: Update the test** `test/seed.test.ts`: expect `seedVault` to create `["AGENTS.md", "index.md"]` (no `capabilities.md`); assert `AGENTS.md` starts with `---` (OKF frontmatter); keep the idempotency test.
- [ ] **Step 2: Update** `src/seed.ts` `SCAFFOLD`: remove the `capabilities.md` entry; give `AGENTS.md` and `index.md` OKF frontmatter, e.g. `AGENTS.md` → `---\ntype: schema\ntitle: Vault schema\n---\n` + the existing body; `index.md` → `---\ntype: index\ntitle: Index\n---\n` + body.
- [ ] **Step 3: Run** `npx vitest run test/seed.test.ts` → PASS. Then `npm test`.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: seed OKF AGENTS.md/index.md; drop hand-maintained capabilities.md"`

## Task 5: Constitution → OKF + locked role

**Files:** modify `src/constitution.ts`, `test/constitution.test.ts`.

- [ ] **Step 1: Update the test** `test/constitution.test.ts`: assert the constitution contains `index.md`, `AGENTS.md`, `frontmatter` (OKF), `never execute`, and `invoke` (it returns invoke-plans); drop the `capabilities.md` assertion.
- [ ] **Step 2: Update** `src/constitution.ts` CONSTITUTION string to:
```typescript
export const CONSTITUTION = `You are the agent inside a user's Geode vault: a structured, git-backed directory of their personal context, recipes, and SOPs.

Discipline (always):
- Treat the directory as a maintained vault. Follow the AGENTS.md schema. Author concepts as OKF files: YAML frontmatter with at least \`type\` (plus \`title\`/\`description\`/\`tags\`) and a markdown body.
- After any change, keep index.md current (a catalog of concepts with one-line summaries + links) and append a concise line to log.md.
- Canonical facts live in exactly one file; reference them by path, never copy. Rules defined higher in the tree cascade down — don't restate them.
- You NEVER execute external actions and NEVER call integrations. When asked how to do something that uses an integration, read its integrations/<name>/manifest.json and return the exact ordered invoke(integration, action, params) calls the caller should run.
- Never write secrets into files; you never need them.
- Prefer small, well-placed edits over rewrites. Explain what you changed.

You have read/write/bash access within the vault. Every run is committed to git, so changes are recoverable; work decisively but tidily.`;
```
- [ ] **Step 3: Run** `npx vitest run test/constitution.test.ts` → PASS. Then `npm test`.
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: constitution adopts OKF + locked role (never execute / return invoke-plans)"`

## Task 6: Full verification

- [ ] **Step 1:** `npm test` → all green (find tests removed; query/capabilities/seed/constitution updated). `npx tsc --noEmit` → clean. `npm run build` → emits cleanly.
- [ ] **Step 2 (live smoke, manual/optional):** start the kernel on a temp vault; confirm `query` works (renamed), `find` is gone from `tools/list`, and `list_capabilities` returns the derived menu (empty-vault note, since no integrations/recipes yet). Document result; no commit unless a fix was needed.

## Notes for the implementer
- This is a refactor — **no new product capability**. The full suite must stay green; behavior of `query`/`remember` is unchanged besides the rename.
- Do NOT add the broker, `invoke`, integrations, or artifacts — those are Increment 2.
- Keep exported names exactly as written (`query`, `QueryDeps`, `QueryResult`, `parseFrontmatter`, `deriveCapabilities`).

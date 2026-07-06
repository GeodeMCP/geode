# Graph-Index Compiler (v1 "motor") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile the vault's markdown into a deterministic capability graph (`.geode/graph.json`) at write-time, so reads no longer re-derive it every call.

**Architecture:** A new `src/graph.ts` module evolves the read-time `deriveCapabilities` into a `buildGraph(root, secrets)` compiler: it walks the vault, classifies each markdown file into a typed **node** (tool/reference/sop/gap), derives typed **edges** from `[[links]]` + relative-path links (never prose), groups by **domain**, and serializes deterministically. The librarian runs it on write, at startup, and via a `rebuild` command. Markdown stays the source of truth; the graph is a rebuildable, deterministically-committed cache.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, tsx.

**Source of truth:** `docs/design/2026-07-06-capability-foundation.md` → *"The index IS a graph"* → *"Concrete v1 design (locked 2026-07-06, option A)"*.

## Global Constraints

- All in-app/UI/code strings in **English**.
- New exported symbols need JSDoc (husky pre-commit gate).
- ESM: `.js` import specifiers even for `.ts` files.
- Tests: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`.
- **Determinism is a hard requirement:** stable ordering, no timestamps/random — same vault ⇒ byte-identical `.geode/graph.json`.
- **Scope = the compiler only.** Consumers (`list_capabilities` render, `query` scoped-subgraph retrieval, generated `index.md`) are later phases — do NOT rewire them here.

## File Structure

- `src/graph.ts` (create) — node/edge types, `buildGraph`, `serializeGraph`, `writeGraph`, `GRAPH_PATH`.
- `src/graphCli.ts` (create) — `graph rebuild` entry point.
- `package.json` (modify) — add `"graph": "tsx src/graphCli.ts"` script.
- `src/query.ts` (modify) — after a committed write, rebuild + commit the graph.
- `src/index.ts` (modify) — build the graph once at startup.
- `test/graph.test.ts` (create) — fixture-vault tests for nodes, edges, determinism, persistence.

## Data shapes (defined once, used by every task)

```typescript
export type NodeType = "tool" | "reference" | "sop" | "gap";
export type EdgeType = "uses" | "references" | "blocks";

export interface GraphNode {
  id: string;                 // vault-relative, extension-stripped: "tools/moneybird", "notes/administratie/overview"
  type: NodeType;
  title: string;
  description: string;
  domain: string;             // grouping; "" when ungrouped
  path: string;               // source file, vault-relative
  actions?: string[];         // tool only
  connections?: { label: string; configured: boolean }[]; // tool only
  kind?: string;              // gap only
  count?: number;             // gap only (v1: 1; real frequency lands with the backlog-loop)
}
export interface GraphEdge { from: string; to: string; type: EdgeType }
export interface VaultGraph { nodes: GraphNode[]; edges: GraphEdge[] }
```

---

### Task 1: Node extraction (`buildNodes`)

**Files:**
- Create: `src/graph.ts`
- Test: `test/graph.test.ts` (create)

**Interfaces:**
- Consumes: `parseFrontmatter` from `./capabilities.js`; `listToolIds`, `loadTool`, `connectionConfigured` from `./tools.js`.
- Produces: the types above; `buildNodes(root: string, secrets: Pick<SecretStore, "get">): Promise<GraphNode[]>`.

**Node rules (deterministic):**
- Tools: one node per `tools/<id>/TOOL.md`, `id = "tools/<id>"`, `type: "tool"`, `actions = Object.keys(manifest.actions)`, `connections` via `connectionConfigured`.
- Markdown under `notes/`, `backlog/`: `id = <relpath without ".md">`, `type` from frontmatter `type` mapped: `recipe|skill|sop → "sop"`, `gap → "gap"`, everything else → `"reference"`. Skip `index.md`, `log.md`, and files without frontmatter `type`.
- `domain = frontmatter.tags?.[0] ?? secondPathSegment(notes/<domain>/…) ?? ""`.
- Skip `.git`, `node_modules`, `artifacts`, `.geode`.

- [ ] **Step 1: Write the failing test** — create `test/graph.test.ts` with a fixture vault + a node assertion:

```typescript
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { buildNodes } from "../src/graph.js";

const noSecrets = { get: async () => null };

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-"));
  mkdirSync(join(root, "tools/moneybird"), { recursive: true });
  writeFileSync(join(root, "tools/moneybird/TOOL.md"),
    `---\nid: moneybird\nname: Moneybird\ntype: http\ndescription: MB\nconnections: [{ label: default }]\nactions: { list_mutations: { http: { method: GET, url: "https://x/m" } } }\n---\n`);
  mkdirSync(join(root, "notes/administratie"), { recursive: true });
  writeFileSync(join(root, "notes/administratie/sop-booking.md"),
    `---\ntype: sop\ntitle: SOP boeken\ndescription: boek\ntags: [administratie]\n---\nGebruik [[moneybird]].\n`);
  writeFileSync(join(root, "backlog/mb-attach.md"),
    `---\ntype: gap\nkind: tool\ntitle: MB attachment\ndescription: gap\ntags: [administratie]\n---\nBlokkeert [moneybird](../tools/moneybird/TOOL.md).\n`);
  return root;
}

test("buildNodes classifies tool, sop, gap with domain", async () => {
  const nodes = await buildNodes(fixture(), noSecrets);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  expect(byId["tools/moneybird"].type).toBe("tool");
  expect(byId["tools/moneybird"].actions).toContain("list_mutations");
  expect(byId["notes/administratie/sop-booking"]).toMatchObject({ type: "sop", domain: "administratie" });
  expect(byId["backlog/mb-attach"]).toMatchObject({ type: "gap", kind: "tool", count: 1 });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run test/graph.test.ts` → FAIL (`buildNodes` not exported).

- [ ] **Step 3: Implement** `src/graph.ts` with the types above plus:

```typescript
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseFrontmatter } from "./capabilities.js";
import { listToolIds, loadTool, connectionConfigured } from "./tools.js";
import type { SecretStore } from "./secrets.js";

const SKIP_DIRS = new Set([".git", "node_modules", "artifacts", ".geode", "tools"]);
const SKIP_FILES = new Set(["index.md", "log.md"]);

/** Collects vault-relative markdown paths (POSIX slashes), skipping generated/tool dirs. */
async function walkMd(root: string, dir: string, out: string[]): Promise<void> {
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walkMd(root, join(dir, e.name), out); }
    else if (e.name.endsWith(".md") && !SKIP_FILES.has(e.name)) out.push(relative(root, join(dir, e.name)).split(sep).join("/"));
  }
}

const nodeType = (t?: string): NodeType | null =>
  t === "gap" ? "gap" : t === "recipe" || t === "skill" || t === "sop" ? "sop" : t ? "reference" : null;

/** Extracts typed capability nodes (tools + typed markdown concepts) from the vault. */
export async function buildNodes(root: string, secrets: Pick<SecretStore, "get">): Promise<GraphNode[]> {
  const nodes: GraphNode[] = [];
  for (const id of await listToolIds(root)) {
    try {
      const m = await loadTool(root, id);
      const connections = [];
      for (const c of m.connections ?? []) connections.push({ label: c.label, configured: await connectionConfigured(secrets, m.id, c.label, m.requires ?? []) });
      nodes.push({ id: `tools/${m.id}`, type: "tool", title: m.name, description: m.description, domain: "", path: `tools/${m.id}/TOOL.md`, actions: Object.keys(m.actions), connections });
    } catch { /* skip malformed */ }
  }
  const files: string[] = [];
  await walkMd(root, root, files);
  for (const rel of files) {
    const fm = parseFrontmatter(await readFile(join(root, rel), "utf8").catch(() => ""));
    const type = nodeType(fm.type);
    if (!type) continue;
    const domain = fm.tags?.[0] ?? (rel.startsWith("notes/") ? rel.split("/")[1] : "") ?? "";
    const node: GraphNode = { id: rel.replace(/\.md$/, ""), type, title: fm.title ?? rel, description: fm.description ?? "", domain, path: rel };
    if (type === "gap") { node.kind = fm.kind; node.count = 1; }
    nodes.push(node);
  }
  return nodes;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run test/graph.test.ts` → PASS.
- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit** — `git add src/graph.ts test/graph.test.ts && git commit -m "feat(graph): compile typed capability nodes from the vault"`

---

### Task 2: Edge extraction (`buildEdges`)

**Files:** Modify `src/graph.ts`; Test `test/graph.test.ts`.

**Interfaces:** Produces `buildEdges(nodes: GraphNode[], root: string): Promise<GraphEdge[]>`.

**Edge rules (deterministic):** for each node, scan its file body for `[[name]]` and `[text](relpath)` links; resolve each to a node `id` (a `[[name]]` matches a node whose `id` ends in `/name` or equals `tools/name`; a relative path resolves against the file dir, strips `.md` and a trailing `/TOOL`). For a resolved `from→to`: `from.type==="gap"` → `blocks`; `from.type==="sop"` && `to.type==="tool"` → `uses`; else `references`. Drop links that resolve to no node. Dedupe identical edges.

- [ ] **Step 1: Failing test** (append to `test/graph.test.ts`):

```typescript
import { buildEdges } from "../src/graph.js";
test("buildEdges types links from sop/gap to the moneybird tool", async () => {
  const root = fixture();
  const edges = await buildEdges(await buildNodes(root, noSecrets), root);
  expect(edges).toContainEqual({ from: "notes/administratie/sop-booking", to: "tools/moneybird", type: "uses" });
  expect(edges).toContainEqual({ from: "backlog/mb-attach", to: "tools/moneybird", type: "blocks" });
});
```

- [ ] **Step 2: Run → FAIL** (`buildEdges` not exported).
- [ ] **Step 3: Implement** `buildEdges` in `src/graph.ts` per the rules above (resolve `[[wikilinks]]` via a suffix/`tools/` match against node ids; resolve markdown relative links via `path.join(dirname(rel), href)` then strip `.md`/`/TOOL`; type by source/target; dedupe with a `from|type|to` set).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/graph.ts test/graph.test.ts && git commit -m "feat(graph): derive typed edges from links + frontmatter"`

---

### Task 3: Assemble + deterministic ordering (`buildGraph`)

**Files:** Modify `src/graph.ts`; Test `test/graph.test.ts`.

**Interfaces:** Produces `buildGraph(root, secrets): Promise<VaultGraph>` = `{ nodes, edges }` with nodes sorted by `id` and edges sorted by `(from, type, to)`.

- [ ] **Step 1: Failing test** — assert `buildGraph(root)` returns nodes in ascending `id` order and edges sorted, and that two runs are deep-equal.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `buildGraph` calling `buildNodes` then `buildEdges`, then `nodes.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)` and edges sorted by the `(from,type,to)` tuple.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(graph): assemble buildGraph with stable ordering"`

---

### Task 4: Deterministic serialization + persistence

**Files:** Modify `src/graph.ts`; Test `test/graph.test.ts`.

**Interfaces:** Produces `GRAPH_PATH = ".geode/graph.json"`; `serializeGraph(g: VaultGraph): string` (stable-key JSON, trailing newline); `writeGraph(root, g): Promise<void>` (mkdir `.geode`, write `GRAPH_PATH`).

- [ ] **Step 1: Failing test** — build a graph, `serializeGraph` it twice → **byte-identical strings**; `writeGraph` then read back `.geode/graph.json` and `JSON.parse` equals the graph.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `serializeGraph` (emit objects with keys in a fixed order — build each node/edge object literal in a fixed field order and `JSON.stringify(_, null, 2) + "\n"`; do NOT rely on insertion order of parsed frontmatter — construct fresh literals) and `writeGraph`.
- [ ] **Step 4: Run → PASS.** Then `npx vitest run` (full suite) → all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(graph): deterministic serialization + .geode/graph.json persistence"`

---

### Task 5: Generation triggers (rebuild CLI + write-path + startup)

**Files:** Create `src/graphCli.ts`; Modify `package.json`, `src/query.ts`, `src/index.ts`.

- [ ] **Step 1: Rebuild CLI** — `src/graphCli.ts` loads config (`loadConfig`), builds the secret store like `index.ts`, calls `writeGraph(root, await buildGraph(root, secrets))`, prints node/edge counts. Add `"graph": "tsx src/graphCli.ts"` to `package.json` scripts.
- [ ] **Step 2: Verify the CLI on the real vault** — `npx tsx --env-file=.env src/graphCli.ts` → prints counts and creates `~/geode-vault/.geode/graph.json`. Inspect it: expect `tools/moneybird`, `tools/productflow`, the administratie sop/reference/gap nodes, and `uses`/`references`/`blocks` edges.
- [ ] **Step 3: Rebuild after each committed write** — in `src/query.ts`, after the successful `commitAll(\`query ${runId}: ...\`)` (auto-commit branch, ~line 95–100), call `writeGraph(deps.workspace.root, await buildGraph(deps.workspace.root, deps.secrets))` and `commitAll(\`graph: rebuild ${runId}\`)`. (Thread `secrets` into `QueryDeps` if not already present; `index.ts` already has the store.) Determinism means this only produces a diff when content changed.
- [ ] **Step 4: Startup build** — in `src/index.ts` `main()`, after `workspace.init()` and seeding, call `writeGraph(config.workspaceRoot, await buildGraph(config.workspaceRoot, secrets))` and commit if it changed, so a freshly cloned vault has a current graph.
- [ ] **Step 5: Full suite + typecheck** — `npx vitest run` and `npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(graph): rebuild on write, at startup, and via 'npm run graph'"`

---

## Self-Review

- **Spec coverage:** implements the *Concrete v1 design* — nodes (tool/reference/sop/gap + domain), typed edges from links only, deterministic `.geode/graph.json`, generation on write/startup/rebuild, option A (parseable edges now). Consumers + embeddings are explicitly out of scope (later phases) — matches the spec's phasing.
- **Placeholders:** none. `count: 1` for gaps is an intentional v1 value (real frequency lands with the backlog-loop), documented in the data-shapes block.
- **Type consistency:** `GraphNode`/`GraphEdge`/`VaultGraph`, `buildNodes`/`buildEdges`/`buildGraph`/`serializeGraph`/`writeGraph`/`GRAPH_PATH` are defined in Tasks 1/4 and used verbatim in later tasks and tests.

## Follow-up (not this plan)

- `list_capabilities` renders a view of the graph (structured markdown + XML block-fences).
- `query` retrieves a scoped subgraph (keyword/tag entry + traversal) and feeds only that to the desk.
- `index.md` becomes a generated render of the graph.
- Real gap `count` (backlog-loop frequency) and, when vaults grow, embedding-based entry-node retrieval.

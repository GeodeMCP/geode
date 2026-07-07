# `list_capabilities` renders from the graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MCP `list_capabilities` tool render the compiled graph as domain-grouped, XML-fenced structured markdown, replacing the read-time flat-prose `deriveCapabilities` scan for that surface.

**Architecture:** A new `src/capabilitiesRender.ts` exports `renderCapabilities(graph)` (the view) and `loadGraph(root, secrets)` (read `.geode/graph.json`, else build it). `src/server.ts`'s `list_capabilities` handler is rewired to `renderCapabilities(await loadGraph(root, secrets))`. This is the first *consumer* of the graph compiler (built in `src/graph.ts`). `deriveCapabilities` stays for its other callers (dashboard `/api/gaps`, NeedsAttention) — migrating those is out of scope.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, tsx.

**Source of truth:** `docs/design/2026-07-06-capability-foundation.md` → "Serialization & formats" (model-facing `list_capabilities` = structured markdown grouped by domain, typed fields + relationships, thin XML block-fences per capability) and "The tool contract" (`list_capabilities` = introspection).

## Global Constraints
- All in-app/UI/code strings in **English**.
- New exported symbols need JSDoc (husky gate).
- ESM: `.js` import specifiers.
- **Determinism:** same graph ⇒ byte-identical rendered text (stable domain + node order; nodes/edges arrive already sorted from `buildGraph`).
- Tests `npx vitest run <path>`; typecheck `npx tsc --noEmit`.
- **Scope = the MCP `list_capabilities` render + its graph loader.** Do NOT touch `query`, `remember`, the dashboard consumers of `deriveCapabilities`, or `index.md` generation (later phases).

## Graph API consumed (from `src/graph.ts`, do not modify)
`VaultGraph = { nodes: GraphNode[]; edges: GraphEdge[] }`; `GraphNode { id, type: "tool"|"reference"|"sop"|"gap", title, description, domain, path, actions?, connections?: {label, configured}[], kind?, count? }`; `GraphEdge { from, to, type: "uses"|"references"|"blocks" }`; `buildGraph(root, secrets): Promise<VaultGraph>`; `GRAPH_PATH = ".geode/graph.json"`.

## Render format (deterministic)
```
# Capabilities

## <domain>            (domains sorted asc; nodes with empty domain grouped last under "## (ungrouped)")

<tool id="tools/moneybird" state="needs-setup">     (state = "ok" if all connections configured, else "needs-setup"; omit for non-tools)
<one-line description>
actions: list_mutations, link_booking, …
connections: mijnwebontwikkelaar (needs setup), roverm (needs setup)
used-by: notes/administratie/sop-moneybird-booking          (incoming "uses" edges)
</tool>

<sop id="notes/administratie/sop-moneybird-booking">
<description>
uses: tools/moneybird                                       (outgoing "uses" edges)
</sop>

<gap id="backlog/moneybird-attachment-upload" kind="tool" count="1">
<description>
blocks: tools/moneybird                                     (outgoing "blocks" edges)
</gap>
```
Rules: node open tag `<${type} id="${id}"...>`; include `state` only on tools, `kind`/`count` only on gaps. Body lines emitted only when non-empty, in a fixed order: description, `actions:`, `connections:`, then relationship lines. Relationship lines per node: outgoing edges as `${type}: a, b` (grouped by edge type, targets sorted); incoming `uses` edges as `used-by: …`. Everything sorted so output is deterministic.

---

### Task 1: `renderCapabilities(graph)`

**Files:** Create `src/capabilitiesRender.ts`; Test `test/capabilitiesRender.test.ts` (create).

**Interfaces:** Consumes `VaultGraph`/`GraphNode`/`GraphEdge` from `./graph.js`. Produces `renderCapabilities(graph: VaultGraph): string`.

- [ ] **Step 1: Write the failing test** — `test/capabilitiesRender.test.ts` builds a small in-memory `VaultGraph` (a `tools/moneybird` tool node with `domain:"administratie"`, `actions:["list_mutations","link_booking"]`, `connections:[{label:"roverm",configured:false}]`; a `notes/administratie/sop-booking` sop node; a `backlog/mb-attach` gap node kind `tool` count 1; edges: sop→moneybird `uses`, gap→moneybird `blocks`) and asserts, structurally:
  - contains `## administratie`
  - contains `<tool id="tools/moneybird" state="needs-setup">` and its block has `actions: list_mutations, link_booking`, `connections: roverm (needs setup)`, and `used-by: notes/administratie/sop-booking`
  - the sop block (`<sop id="notes/administratie/sop-booking">`) contains `uses: tools/moneybird`
  - the gap block (`<gap id="backlog/mb-attach" kind="tool" count="1">`) contains `blocks: tools/moneybird`
  - `renderCapabilities(graph) === renderCapabilities(graph)` (deterministic)

- [ ] **Step 2: Run → FAIL** — `npx vitest run test/capabilitiesRender.test.ts` (renderCapabilities not exported).
- [ ] **Step 3: Implement** `src/capabilitiesRender.ts` per the Render format above. Group nodes by `domain` (sorted; empty domain last as "(ungrouped)"), emit each node's XML block with the fixed-order body lines, compute tool `state` from `connections.every(c => c.configured)`, and derive relationship lines from `graph.edges` (outgoing by type; incoming `uses` → `used-by`). Deterministic ordering throughout. JSDoc on the export.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/capabilitiesRender.ts test/capabilitiesRender.test.ts && git commit -m "feat(capabilities): render the graph as domain-grouped XML-fenced markdown"`

---

### Task 2: `loadGraph(root, secrets)`

**Files:** Modify `src/capabilitiesRender.ts`; Test `test/capabilitiesRender.test.ts`.

**Interfaces:** Consumes `buildGraph`, `GRAPH_PATH` from `./graph.js`. Produces `loadGraph(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultGraph>`.

- [ ] **Step 1: Failing test** — assert: given a vault dir with a valid `.geode/graph.json`, `loadGraph` returns the parsed graph (deep-equal to the file's contents); given a vault dir WITHOUT `.geode/graph.json`, `loadGraph` returns `await buildGraph(root, secrets)` (e.g. build a tiny fixture vault with one tool and assert the returned graph has that tool node).
- [ ] **Step 2: Run → FAIL** (loadGraph not exported).
- [ ] **Step 3: Implement** `loadGraph`: `try { return JSON.parse(await readFile(join(root, GRAPH_PATH), "utf8")) as VaultGraph } catch { return buildGraph(root, secrets) }`. JSDoc.
- [ ] **Step 4: Run → PASS.** Then `npx vitest run` (full suite) + `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(capabilities): loadGraph reads .geode/graph.json, falls back to buildGraph"`

---

### Task 3: Wire the MCP `list_capabilities` handler + verify

**Files:** Modify `src/server.ts`.

- [ ] **Step 1: Read the handler** — `makeListCapabilitiesHandler` (`src/server.ts:88-119`) and its call site (`src/server.ts:154`, currently `derive: (root) => deriveCapabilities(root, secrets)`). Note the exact shape the handler expects back from `derive` (a `CapabilitySummary` with `.text`, or the text directly) so you adapt correctly.
- [ ] **Step 2: Rewire** — change the `derive` passed at the call site so `list_capabilities` renders from the graph: `renderCapabilities(await loadGraph(queryDeps.workspace.root, opts?.secrets ?? { get: async () => null }))`. If the handler expects a `{ text }`-shaped object, wrap the string as `{ text: ... }` (or minimally adjust the handler to return the string) — keep the change surgical and keep the handler's other behaviour. Import `renderCapabilities`/`loadGraph` from `./capabilitiesRender.js`. Do NOT remove the `deriveCapabilities` import if it's still used elsewhere in the file; if `list_capabilities` was its only use in `server.ts`, remove the now-unused import.
- [ ] **Step 3: Full suite + typecheck** — `npx vitest run` and `npx tsc --noEmit` clean. Fix any `server.test.ts` cases that pinned the old flat-prose `list_capabilities` output (update them to the new graph render — the new output is the intended behaviour; assert on the new structure, not the old prose).
- [ ] **Step 4: Verify over MCP** — with the server running (`npx tsx --env-file=.env src/index.ts`) call `list_capabilities` via an MCP client (or `npm run graph` first to ensure `~/geode-vault/.geode/graph.json` exists). Expect the new domain-grouped, XML-fenced output (tools/productflow, tools/moneybird, administratie SOPs/gap, etc.) instead of the old flat "## Tools / ## Recipes / ## Planned" prose. Record a snippet in your report.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(capabilities): list_capabilities renders from the graph"`

---

## Self-Review
- **Spec coverage:** implements the "model-facing `list_capabilities` = domain-grouped structured markdown + thin XML block-fences" decision, sourced from the compiled graph. `query` scoped-retrieval, `index.md` generation, and a filter/scoping arg on `list_capabilities` are explicitly out of scope (later phases).
- **Placeholders:** none. `renderCapabilities` output shape is pinned by the Task-1 test's structural assertions.
- **Type consistency:** `renderCapabilities(graph)` and `loadGraph(root, secrets)` signatures match their tests and the Task-3 call site.

## Follow-up (not this plan)
- `query` reads a scoped subgraph (keyword/tag entry + traversal) and feeds only that to the desk — the latency win.
- Migrate the dashboard's `deriveCapabilities` consumers to the graph; then retire `deriveCapabilities`.
- A filter/scoping argument on `list_capabilities` for large vaults; `index.md` generated from the graph.

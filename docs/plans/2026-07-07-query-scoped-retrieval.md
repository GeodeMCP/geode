# `query` scoped-subgraph retrieval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `query` (the desk) start from a *scoped subgraph* selected from the instruction — the relevant capabilities + their 1-hop neighbours, injected as context — instead of scanning the whole vault. This is the latency/precision lever the capability graph was built for.

**Architecture:** A new pure module `src/retrieval.ts` exports `selectSubgraph(graph, instruction)` (score nodes by instruction-term overlap → top-K entry nodes → expand 1 hop across edges → induced subgraph) and `renderScopedContext(subgraph)` (a compact, path-first navigation hint). `query()` loads the compiled graph (`loadGraph`), and **for the desk role only** prepends the rendered scoped context to the engine instruction. Retrieval is best-effort: any failure or an empty match injects nothing and the desk falls back to its current behaviour (reading `index.md` + files itself). The librarian (filing) is unaffected — it still sees the whole vault.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, tsx.

**Source of truth:** `docs/design/2026-07-06-capability-foundation.md` → the follow-up "`query` reads a scoped subgraph (keyword/tag entry + traversal) and feeds only that to the desk — the latency win."

## Global Constraints
- All in-app/UI/code strings in **English**.
- New exported symbols need JSDoc (husky gate).
- ESM: `.js` import specifiers.
- **Determinism:** same `(graph, instruction)` ⇒ identical subgraph and identical rendered text (stable ordering; the graph's nodes/edges already arrive sorted from `buildGraph`).
- **Best-effort:** retrieval must NEVER fail a query. Wrap the graph load + selection in try/catch; on any error or empty result, inject nothing.
- **Desk-only:** scoped retrieval is injected only when the resolved role is `desk`. The librarian/onboarding path gets no retrieval note.
- Tests `npx vitest run <path>`; typecheck `npx tsc --noEmit`.
- **Scope = desk-side scoped retrieval + its wiring.** Do NOT touch the librarian path, `list_capabilities`, `index.md` generation, or the graph compiler.

## Graph API consumed (from existing code, do not modify)
`VaultGraph = { nodes: GraphNode[]; edges: GraphEdge[] }`; `GraphNode { id, type: "tool"|"reference"|"sop"|"gap", title, description, domain, path, actions?, connections?, kind?, count? }`; `GraphEdge { from, to, type: "uses"|"references"|"blocks" }` — all from `./graph.js`. `loadGraph(root: string, secrets: Pick<SecretStore,"get">): Promise<VaultGraph>` from `./capabilitiesRender.js`.

---

### Task 1: `selectSubgraph(graph, instruction)`

**Files:** Create `src/retrieval.ts`; Test `test/retrieval.test.ts` (create).

**Interfaces:** Consumes `VaultGraph`/`GraphNode`/`GraphEdge` from `./graph.js`. Produces `selectSubgraph(graph: VaultGraph, instruction: string, opts?: { entries?: number; hops?: number }): VaultGraph`.

**Behaviour (implement exactly):**
- Tokenize the instruction: `instruction.toLowerCase().match(/[a-z0-9]+/g) ?? []`, keep terms with length ≥ 3 that are not in `STOPWORDS`, dedupe.
- `STOPWORDS` = a small set: `the, and, for, how, use, using, get, can, you, your, with, what, which, from, this, that, are, was, does, run, hoe, wat, met, kan, een, het, mijn, voor, van, ophalen, laatste` (English + a few Dutch).
- `searchable(node)` = `` `${node.id} ${node.title} ${node.description} ${node.domain} ${(node.actions ?? []).join(" ")}`.toLowerCase() ``.
- `score(node)` = count of terms `t` where `searchable(node).includes(t)`.
- Entry nodes = nodes with `score > 0`, sorted by `score` **descending**, tie-break by `id` **ascending**; take the first `opts.entries ?? 6`.
- Expand `opts.hops ?? 1` times: in each pass, for every edge, if either endpoint id is already selected, add the other endpoint id. (One pass = include direct neighbours.)
- Induced subgraph: `nodes` = `graph.nodes.filter(n => selected.has(n.id))`, `edges` = `graph.edges.filter(e => selected.has(e.from) && selected.has(e.to))`. Both preserve the graph's existing (sorted) order ⇒ deterministic. Return `{ nodes, edges }`.

- [ ] **Step 1: Write the failing test** — `test/retrieval.test.ts` builds a small in-memory `VaultGraph`: a `tools/moneybird` tool (`title:"Moneybird"`, `description:"REST API voor boekhouding"`, `actions:["list_mutations","link_booking"]`, `domain:"administratie"`), a `notes/administratie/sop-booking` sop (`title:"SOP boeken"`, `description:"boek bankmutaties"`), an unrelated `notes/pricing` reference (`title:"Pricing"`, `description:"standup"`), and an edge `{ from:"notes/administratie/sop-booking", to:"tools/moneybird", type:"uses" }`. Assert:
  - `selectSubgraph(graph, "how do I book bankmutaties in moneybird")` — its node ids include `notes/administratie/sop-booking` (matches "book"/"boek") AND `tools/moneybird` (pulled in 1 hop via the `uses` edge), and its edges include the `uses` edge; it does NOT include `notes/pricing`.
  - `selectSubgraph(graph, "xyzzy qqq zzz")` (no matches) returns `{ nodes: [], edges: [] }`.
  - determinism: `JSON.stringify(selectSubgraph(g, i)) === JSON.stringify(selectSubgraph(g, i))`.

- [ ] **Step 2: Run → FAIL** — `npx vitest run test/retrieval.test.ts` (selectSubgraph not exported).
- [ ] **Step 3: Implement** `selectSubgraph` per the behaviour above (plus the `STOPWORDS` set). JSDoc on the export.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/retrieval.ts test/retrieval.test.ts && git commit -m "feat(retrieval): selectSubgraph scores + expands a scoped subgraph from an instruction"`

---

### Task 2: `renderScopedContext(subgraph)`

**Files:** Modify `src/retrieval.ts`; Test `test/retrieval.test.ts`.

**Interfaces:** Produces `renderScopedContext(sub: VaultGraph): string`.

**Behaviour (implement exactly):**
- If `sub.nodes.length === 0` → return `""`.
- Otherwise return a header line, then one line per node (in `sub.nodes` order), joined by `"\n"`:
  - Header: `Relevant vault capabilities for this request (pre-selected from the capability graph — start here and read these files as needed instead of scanning the whole vault; if none fit, consult index.md):`
  - Per node: `- ${node.path} — ${node.type}: ${node.title}. ${truncate(node.description, 160)}${rels}${actions}`
    - `truncate(s, n)` = `s.length > n ? s.slice(0, n) + "…" : s` (local helper; do not export).
    - `rels` = outgoing edges of this node from `sub.edges`, grouped by type in the fixed order `uses`, `references`, `blocks`; each present type appended as ` · ${type} ${targets.join(", ")}` with targets sorted ascending. (Omit types with no edges.)
    - `actions` = for `tool` nodes with a non-empty `actions` array: ` · actions: ${node.actions.join(", ")}`. Empty for non-tools.
- Deterministic (node order from the subgraph; targets sorted).

- [ ] **Step 1: Write the failing test** — extend `test/retrieval.test.ts`: from the Task-1 fixture, `const text = renderScopedContext(selectSubgraph(graph, "how do I book in moneybird"))` and assert:
  - contains `tools/moneybird/TOOL.md` is NOT required (the fixture node's `path` is what's asserted) — assert `text` contains the sop node's `path` and the tool node's `path`.
  - contains `· uses tools/moneybird` on the sop line.
  - contains `· actions: list_mutations, link_booking` on the tool line.
  - `renderScopedContext({ nodes: [], edges: [] })` returns `""`.
  - (Set the fixture nodes' `path` to real-looking values, e.g. sop `path:"notes/administratie/sop-booking.md"`, tool `path:"tools/moneybird/TOOL.md"`, and assert those.)

- [ ] **Step 2: Run → FAIL** (renderScopedContext not exported).
- [ ] **Step 3: Implement** `renderScopedContext` per the behaviour. JSDoc.
- [ ] **Step 4: Run → PASS.** Then `npx vitest run` (full suite) + `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(retrieval): renderScopedContext renders a compact path-first hint"`

---

### Task 3: Wire scoped retrieval into `query` (desk only)

**Files:** Modify `src/query.ts`; Test `test/query.test.ts`.

**Interfaces:** Consumes `selectSubgraph`, `renderScopedContext` from `./retrieval.js`; `loadGraph` from `./capabilitiesRender.js`.

**Wiring (implement exactly):** In `query()` (src/query.ts), inside the `try` block, replace the inline role computation with a hoisted `const role` and build a `retrievalNote`:

```ts
const role = opts?.role ?? (opts?.attachmentDirs?.length ? "librarian" : "desk");
let retrievalNote = "";
if (role === "desk") {
  try {
    const graph = await loadGraph(deps.workspace.root, deps.secrets ?? { get: async () => null });
    const scoped = renderScopedContext(selectSubgraph(graph, instruction));
    if (scoped) retrievalNote = `${scoped}\n\n`;
  } catch {
    /* retrieval is best-effort; never fail a query over it */
  }
}
const engineInstruction = `${historyNote}${attachmentNote}${retrievalNote}${instruction}`;
```

Then change the `systemPrompt` argument in the `deps.engine({...})` call from the inline `opts?.role ?? (...)` expression to the hoisted `role`. Add the imports at the top: `import { selectSubgraph, renderScopedContext } from "./retrieval.js";` and add `loadGraph` to the existing `./capabilitiesRender.js` import (create the import if none exists). Keep everything else in `query()` unchanged (commit logic, graph rebuild, error path).

- [ ] **Step 1: Read** `src/query.ts:64-100` — confirm the current `engineInstruction` assembly (`historyNote`/`attachmentNote`) and the `composeSystemPrompt(deps, opts?.role ?? (...))` call site, so the edit is surgical.
- [ ] **Step 2: Write the failing test** — in `test/query.test.ts`, add a capturing engine that records the `instruction` it receives:
```ts
function capturingEngine() {
  const seen: { instruction?: string } = {};
  const gen = async function* (arg: any) {
    seen.instruction = arg.instruction;
    yield { type: "result", text: "done" } as EngineEvent;
  };
  return Object.assign(gen, { seen });
}
```
  Build a real temp vault (like `test/graph.test.ts`'s fixture: `tools/moneybird/TOOL.md` with an `actions` map, and `notes/administratie/sop-booking.md` `type: sop` whose body links the tool, e.g. `Gebruik [[moneybird]].`). Use `deps({ workspace, engine })` where `workspace` is a `fakeWorkspace()` clone whose `root` is the temp dir (override `root`) and whose git methods stay stubbed, and **no `secrets`** in deps (so the post-commit rebuild block is skipped; retrieval still runs via the no-op fallback). Assert:
  - after `await query(d, "how do I book in moneybird", ...)`, `engine.seen.instruction` contains `tools/moneybird/TOOL.md` and `notes/administratie/sop-booking.md` (the scoped hint was prepended) and contains the original `how do I book in moneybird`.
  - after `await query(d, "...", undefined, { role: "librarian" })` (same vault), `engine.seen.instruction` does NOT contain the "Relevant vault capabilities" header (librarian gets no retrieval note).
  - A control: `await query(d, "xyzzy nonsense zzz", ...)` → `engine.seen.instruction` does NOT contain the "Relevant vault capabilities" header (empty match ⇒ no note), and still contains `xyzzy nonsense zzz`.

- [ ] **Step 3: Run → FAIL** — `npx vitest run test/query.test.ts` (no retrieval note in the captured instruction).
- [ ] **Step 4: Implement** the wiring above.
- [ ] **Step 5: Run → PASS.** Then `npx vitest run` (full suite) + `npx tsc --noEmit` clean. Fix nothing unrelated; if an existing query test asserted the exact `engineInstruction` for a desk run against a real vault, update it to allow the prepended note (desk runs in the existing suite use the fake `/vault` root, where `loadGraph`→`buildGraph` yields an empty graph ⇒ empty note ⇒ those assertions still hold; verify).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(query): desk starts from a scoped subgraph selected from the instruction"`

---

### Task 4: Live verification (controller-run; not a subagent step)

> The controller runs this after Task 3 review. Restart the server on this branch, then over MCP `query` a known task (e.g. "Hoe boek ik een bankmutatie in Moneybird?") and confirm: (a) the plan is still correct (names `tools/moneybird`, the right actions/connection), (b) the run works end-to-end. Record whether the scoped hint measurably helps (note that on a small vault the latency win is modest — the spec calls for a seeded 100+-capability vault + multi-run medians to show the real divergence; that scale test is a separate follow-up). Compare against the spec's baseline (`query` known-plan ~12.7 s; relational ~17.8 s).

---

## Self-Review
- **Spec coverage:** implements "`query` reads a scoped subgraph (keyword/tag entry + traversal) and feeds only that to the desk." Entry-by-term-overlap + 1-hop expansion is the v1; smarter ranking (tags, embeddings) and replacing the desk's file reads entirely are explicitly out of scope.
- **Placeholders:** none. `selectSubgraph`/`renderScopedContext` behaviour is pinned by the Task-1/2 tests.
- **Type consistency:** `selectSubgraph(graph, instruction, opts?)` and `renderScopedContext(sub)` signatures match their tests and the Task-3 call site; `loadGraph(root, secrets)` matches its existing signature.
- **Safety:** retrieval is best-effort (try/catch, empty-match ⇒ no injection), desk-only, and additive (the desk keeps its read access + `index.md` fallback) — it cannot break existing behaviour.

## Follow-up (not this plan)
- A seeded synthetic vault (100+ capabilities) + multi-run median latency benchmark to show the divergence the graph should produce.
- Smarter entry selection (tag/domain weighting, phrase/title boosts) and optionally inlining the top nodes' bodies to cut reads to zero for common cases.
- Generated `index.md` from the graph; migrate the dashboard's `deriveCapabilities` consumers.

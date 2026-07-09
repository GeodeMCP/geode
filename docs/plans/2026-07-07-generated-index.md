# Generated `index.md` from the graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `index.md` a generated artifact rendered from the compiled capability graph (like `.geode/graph.json`), and stop the librarian from hand-maintaining it — so the vault has one source of truth (the markdown files) with two consistent, drift-free derived views: `graph.json` (machine) and `index.md` (human catalog).

**Architecture:** A new `src/indexRender.ts` exports `renderIndex(graph)` (a domain-grouped human-readable markdown catalog) and `writeIndex(root, graph)` (writes `index.md`). `writeIndex` is called at every place the graph is rebuilt, right after `writeGraph`: startup (`index.ts`), the `graph` CLI (`graphCli.ts`), and the post-commit rebuild in `query.ts`. The agent's prompts stop instructing it to maintain `index.md` by hand (constitution, ingest, onboarding note); `log.md` (an append-only human log, not derivable) is still hand-maintained.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, tsx.

**Source of truth:** `docs/design/2026-07-06-capability-foundation.md` → "The index IS a graph" and "index.md becomes generated."

## Global Constraints
- All in-app/UI/code strings in **English** (vault *content* stays the owner's language; `index.md`'s kernel-authored scaffolding — frontmatter + `# Index` + the "generated" note — is English, while node titles/descriptions come verbatim from the vault's frontmatter).
- New exported symbols need JSDoc (husky gate).
- ESM: `.js` import specifiers.
- **Determinism:** same graph ⇒ byte-identical `index.md` (nodes/edges arrive sorted from `buildGraph`; group stably).
- **`log.md` stays hand-maintained** — only `index.md` becomes generated.
- Tests `npx vitest run <path>`; typecheck `npx tsc --noEmit`.
- **Scope = generating `index.md` + retiring its hand-maintenance.** Do NOT touch `graph.json`, `list_capabilities`, retrieval, or `log.md` behaviour.

## Graph API consumed (from `src/graph.ts`, do not modify)
`VaultGraph = { nodes: GraphNode[]; edges: GraphEdge[] }`; `GraphNode { id, type, title, description, domain, path, … }`. `writeGraph(root, graph)` is the sibling this parallels.

## Render format (deterministic)
`renderIndex(graph)` returns, in order:
```
---
type: index
title: Index
description: Generated catalog of the vault — do not edit by hand.
---

# Index

Generated from the vault's capability graph — do not edit by hand; it is rebuilt on every change.

## <domain>
- [<title>](<path>) — <description>
- …
```
Rules: frontmatter block exactly as above; then the `# Index` heading + the one-line generated note; then one `## <domain>` section per domain (domains sorted ascending; nodes whose `domain` is `""` grouped last under `## (ungrouped)`). Within a domain, nodes in `graph.nodes` order (already id-sorted). Each node line: `- [${node.title}](${node.path}) — ${node.description}` (omit the ` — ${description}` tail when description is empty). No trailing whitespace; end the file with a single newline. If the graph has no nodes, emit just the frontmatter + heading + note.

---

### Task 1: `renderIndex(graph)` + `writeIndex(root, graph)`

**Files:** Create `src/indexRender.ts`; Test `test/indexRender.test.ts` (create).

**Interfaces:** Consumes `VaultGraph`/`GraphNode` from `./graph.js`. Produces `renderIndex(graph: VaultGraph): string` and `writeIndex(root: string, graph: VaultGraph): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `test/indexRender.test.ts`:
  - Build a small in-memory `VaultGraph`: a `tools/moneybird` tool (`title:"Moneybird"`, `description:"Moneybird REST API"`, `domain:""`, `path:"tools/moneybird/TOOL.md"`); a `notes/administratie/overview` reference (`title:"Administratie — overzicht"`, `description:"domein-ingang"`, `domain:"administratie"`, `path:"notes/administratie/overview.md"`); a `notes/administratie/sop-booking` sop (`title:"SOP boeken"`, `description:"boek"`, `domain:"administratie"`, `path:"notes/administratie/sop-booking.md"`). (nodes id-sorted as `buildGraph` returns them.)
  - `renderIndex(graph)` asserts: starts with `---\ntype: index\n`; contains `# Index`; contains `## administratie`; contains the exact line `- [SOP boeken](notes/administratie/sop-booking.md) — boek`; contains `- [Administratie — overzicht](notes/administratie/overview.md) — domein-ingang`; groups the moneybird tool under `## (ungrouped)` (it has `domain:""`) with the line `- [Moneybird](tools/moneybird/TOOL.md) — Moneybird REST API`; and `## administratie` appears before `## (ungrouped)`.
  - determinism: `renderIndex(graph) === renderIndex(graph)`.
  - empty graph: `renderIndex({ nodes: [], edges: [] })` contains `# Index` and has NO `##` section headers.
  - `writeIndex`: to a temp dir, `await writeIndex(dir, graph)` then read `join(dir, "index.md")` and assert it equals `renderIndex(graph)`.

- [ ] **Step 2: Run → FAIL** — `npx vitest run test/indexRender.test.ts` (module not found).
- [ ] **Step 3: Implement** `src/indexRender.ts` per the Render format. Group nodes by `domain` (sorted; empty domain last as `(ungrouped)`), emit `- [title](path) — description` lines (omit ` — description` when empty). `writeIndex` = `await writeFile(join(root, "index.md"), renderIndex(graph))` (`writeFile` from `node:fs/promises`, `join` from `node:path`). JSDoc on both exports.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/indexRender.ts test/indexRender.test.ts && git commit -m "feat(index): render index.md as a human catalog from the graph"`

---

### Task 2: Regenerate `index.md` wherever the graph is rebuilt

**Files:** Modify `src/index.ts`, `src/graphCli.ts`, `src/query.ts`; Test `test/query.test.ts` (or the relevant existing test).

**Interfaces:** Consumes `writeIndex` from `./indexRender.js`.

- [ ] **Step 1: Read the three rebuild sites** — `src/index.ts:50` (startup: `await writeGraph(root, await buildGraph(root, secrets))`), `src/graphCli.ts:13-14` (`const graph = await buildGraph(root, secrets); await writeGraph(root, graph);`), `src/query.ts:131` (post-commit: `await writeGraph(deps.workspace.root, await buildGraph(deps.workspace.root, deps.secrets))`).
- [ ] **Step 2: Write the failing test** — in the existing graph/CLI test that exercises `writeGraph` (e.g. `test/graph.test.ts` builds a fixture vault and calls the build), OR add to `test/graphCli`/`test/query`: after a rebuild over a fixture vault, assert `index.md` exists at the vault root and its content equals `renderIndex(await buildGraph(root, secrets))`. Simplest: add a focused test in `test/indexRender.test.ts` is NOT enough (that's Task 1) — instead assert the WIRING: pick `graphCli` or a small integration that calls the rebuild path and check `index.md` is written. If wiring a full path is heavy, add the assertion to whichever existing test already builds a fixture vault and calls `writeGraph`, extended to also expect `index.md`. Run → confirm it FAILS (index.md not written yet by that path).
- [ ] **Step 3: Implement** — at each of the three sites, add `await writeIndex(<root>, <graph>)` immediately after the `await writeGraph(...)` call, reusing the same `graph` value (in `index.ts`/`query.ts`, hoist the built graph into a `const graph` so both `writeGraph` and `writeIndex` receive it instead of building twice). Import `writeIndex` from `./indexRender.js` in each file.
- [ ] **Step 4: Run → PASS.** Then `npx vitest run` (full suite) + `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(index): regenerate index.md on every graph rebuild (startup, CLI, post-write)"`

---

### Task 3: Retire hand-maintenance of `index.md`

**Files:** Modify `src/constitution.ts`, `src/ingest.ts`, `src/query.ts`, `src/seed.ts`; Test `test/constitution.test.ts`.

- [ ] **Step 1: Update the constitution** — `src/constitution.ts:6` currently reads:
  `- After any change, keep index.md current (a catalog of concepts with one-line summaries + links) and append a concise line to log.md.`
  Change to:
  `- After any change, append a concise line to log.md. index.md is generated from the vault — never edit it by hand.`
  (Keeps the substring `index.md` and `log.md`, but flips the instruction: log.md hand-maintained, index.md generated.)

- [ ] **Step 2: Update the ingest instruction** — `src/ingest.ts:15` currently contains `…add cross-references, update index.md and capabilities.md if relevant, and keep it tidy…`. Remove the stale clause so it reads `…add cross-references, and keep it tidy…` (index.md is generated; `capabilities.md` no longer exists — `list_capabilities` is derived).

- [ ] **Step 3: Update the onboarding note** — `src/query.ts:88` contains `…keep index.md/log.md current, and report what you filed.` Change `index.md/log.md` to just `log.md`: `…keep log.md current, and report what you filed.`

- [ ] **Step 4: Update the seed description** — `src/seed.ts:7-11` seeds `index.md` with `description: Catalog of concepts, kept current by the agent`. Change that description line to `description: Generated catalog of the vault — do not edit by hand.` (Keep seeding `index.md` — `test/seed.test.ts` requires it to exist and start with `---`; startup regenerates it via Task 2.)

- [ ] **Step 5: Update the constitution test** — `test/constitution.test.ts` currently only asserts `expect(CONSTITUTION).toContain("index.md")`. Add assertions that lock the new behaviour: `expect(CONSTITUTION).toContain("log.md")` and `expect(CONSTITUTION.toLowerCase()).toContain("generated")` (index.md is described as generated), and `expect(CONSTITUTION).not.toContain("keep index.md current")` (the old hand-maintenance instruction is gone).

- [ ] **Step 6: Run** — `npx vitest run` (full suite) + `npx tsc --noEmit` clean. Fix any test that asserted the old "keep index.md current" wording (update to the new behaviour — it is intended).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(index): stop hand-maintaining index.md (now generated); keep log.md by hand"`

---

### Task 4: Live verification (controller-run; not a subagent step)

> The controller runs this after Task 3 review. Restart the server on this branch, then: (a) `npm run graph` (or let startup run) and confirm `~/geode-vault/index.md` is now the generated catalog (domain-grouped, "do not edit by hand" note) rather than the old hand-written one, and that it matches `renderIndex(buildGraph(...))`; (b) run a `remember` over MCP and confirm the librarian files the content + updates `log.md` but does NOT hand-edit `index.md` (its regeneration comes only from the graph rebuild). Record a snippet + note the version-control behaviour (index.md is now a clean deterministic diff alongside graph.json).

---

## Self-Review
- **Spec coverage:** implements "index.md becomes generated" from the capability-foundation spec. One source of truth (markdown), two derived views (graph.json machine, index.md human). `log.md` remains hand-maintained (append-only, not derivable). Out of scope: touching graph.json, retrieval, or list_capabilities.
- **Placeholders:** none. `renderIndex` output is pinned by the Task-1 structural test.
- **Type consistency:** `renderIndex(graph)` / `writeIndex(root, graph)` match their tests and the three Task-2 call sites; parallels `writeGraph`.
- **Version control:** index.md becomes a deterministic generated artifact committed alongside graph.json in the same rebuild commit — clean diffs, no drift, no hand-maintenance.

## Follow-up (not this plan)
- Optionally give tools their own `## Tools` section instead of `(ungrouped)` if the human catalog wants them more prominent.
- The scale benchmark; dashboard `deriveCapabilities` migration; multi-workspace (#6).

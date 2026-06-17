# Context Tools — Design Spec (Sub-project #2)

> Status: **Draft (brainstorm output, 2026-06-17).** Builds directly on the kernel
> (`2026-06-17-kernel-design.md`) and the architecture doc
> (`2026-06-17-context-vault-architecture.md`). Reuses the kernel's engine, run manager,
> git workspace, event log, and `find` — minimal new machinery.

## 1. Goal & scope

Make the vault **compound** and **discoverable**, and seed its structure. Three deliverables:

1. **`remember`** — an ingest MCP tool: save/update knowledge in the vault, integrated and committed.
2. **`list_capabilities`** — a discovery MCP tool: cheap read of the vault's `capabilities.md`.
3. **Seeding + enriched constitution** — scaffold `AGENTS.md` / `index.md` / `capabilities.md` on a
   fresh vault, and enrich the engine constitution so the agent maintains them.

**Out of scope (deferred):** the autonomous "lint" (scheduled/triggered self-maintenance), `invoke`
+ integrations (#3/#5), the dashboard (#4), multi-workspace (#6).

The full operation surface after #2: `find` · `delegate` · `remember` · `list_capabilities`
(`invoke` arrives with the broker/integrations). Each MCP tool description names the **Geode vault**
so callers route intent reliably.

## 2. `remember` — ingest (the compounding loop)

The owner (or a caller on their behalf) hands over a learning/note/fact; the agent files it well.

- **MCP tool description (coaches the caller):** "Save a distilled learning, fact, or note in your
  Geode vault. Give the *essence* — not a whole conversation; the vault agent integrates, dedups, and
  files it. Example — content: 'Client X wants invoices on the 1st, net-30.', source: 'call 2026-06-17'."
- **Input (self-documenting schema — this IS how an AI caller knows what to send):**
  - `content` (required): "The knowledge to save — a distilled, self-contained learning, fact, or note
    (not a raw transcript); one idea is fine."
  - `source` (optional): "Where it came from, for provenance (e.g. 'Claude chat 2026-06-17', a URL, a person)."
  - `title` (optional): "A short hint of what this is about, to help filing (the agent refines it)."
  - `workspace` (optional): the workspace seam (single/soft for now).
- **Implementation:** a thin wrapper over the kernel's `delegate`:
  - `buildIngestInstruction(content, source, title): string` — **pure** (unit-tested). Produces an
    ingest-framed instruction, roughly: *"Integrate the following into the vault: find or create the
    right page for it, dedup against existing content, add cross-references, update `index.md` and
    `capabilities.md` if relevant, and keep it tidy. Then summarize what you filed and where.
    Title hint: <title>. Source: <source>. Content:\n<content>"* (title/source lines omitted when absent).
  - `remember(deps, args, onProgress?)` calls `delegate(deps, buildIngestInstruction(...), onProgress)`
    — reusing the engine, single-flight run manager, git commit-on-success/reset-on-failure, and
    event log. No new run machinery.
- **Output:** the `DelegateResult` (run-id, commit, files touched, the agent's summary of what it
  filed where).
- **Posture:** runs the full agent (bypassPermissions, git-protected) — same as `delegate`, no new
  security surface.

`remember` is "delegate with an ingest frame" plus a distinct, recognizable MCP tool so callers
reliably pick it for "save this".

### 2.1 How the caller gives good input

Input quality is robust through two layers (plus an optional advanced one):

1. **Schema as documentation.** MCP surfaces the tool `description` + the per-field descriptions above
   to the calling AI — that is literally how it decides what to pass. They coach toward *one distilled
   idea + provenance*, with a worked example.
2. **The agent forgives imperfect input.** Unlike a dumb store, the ingest run **re-distills**: given
   too much (a whole chat) or too little, the agent extracts the essence, dedups against existing
   pages, and files it. Better input → better filing and lower token cost; bad input doesn't break
   anything. This is the key advantage of an agent-in-the-middle for ingest.
3. *(Optional, advanced)* a capable caller can `list_capabilities` or `find AGENTS.md` first to align
   with the vault's conventions before calling `remember`. Not required.

## 3. `list_capabilities` — discovery

- **MCP tool description:** "List what your Geode vault offers — recipes/skills and integrations with
  their actions."
- **Implementation:** `listCapabilities(root): Promise<string>` — a **cheap read** of
  `capabilities.md` at the workspace root (reuses the `find` read path; no agent run). If the file is
  absent (fresh vault before any maintenance), returns a friendly note ("No capabilities manifest yet
  — add context or run a task to populate it.").
- **Maintenance:** `capabilities.md` is written/updated by the agent during `remember`/`delegate`
  runs (per the enriched constitution). Seeding creates the initial scaffold. Loop: agent maintains →
  `list_capabilities` reads.

## 4. Seeding + enriched constitution

**`seedVault(root)`** — a dedicated module (separate from the git workspace manager; single
responsibility). Called at startup after `workspace.init()`. Writes each scaffold file **only if
absent** (idempotent — never clobbers a user's evolved files), then commits any it created.

Scaffold templates:
- **`AGENTS.md`** — the evolvable per-workspace schema: a folder-map placeholder + the core rules
  (canonical sources; rules cascade down, facts live once and are referenced; naming conventions),
  framed as "you and the agent co-evolve this."
- **`index.md`** — `# Index` header + a one-line note that the agent keeps it current (catalog of
  pages with one-line summaries + links).
- **`capabilities.md`** — `# Capabilities` header + sections for recipes/skills and integrations
  (empty initially), agent-maintained, read by `list_capabilities`.

**Enriched constitution** (`src/constitution.ts`, edited) adds, on top of the existing immutable
core: the ingest workflow expectations; "keep `index.md` and `capabilities.md` current after
changes"; the inheritance rules (rules cascade, facts canonical + referenced); and "follow the
`AGENTS.md` schema in this vault." Since the kernel already injects the constitution into every run,
the agent inherits this for `delegate` and `remember` alike.

## 5. File structure (in the geode repo; reuses kernel machinery)

| File | Responsibility |
|---|---|
| `src/ingest.ts` | `buildIngestInstruction(content, source, title)` (pure) + `remember(deps, args, onProgress)` (wraps `delegate`) |
| `src/capabilities.ts` | `listCapabilities(root)` — cheap read of `capabilities.md` + absent-fallback |
| `src/seed.ts` | `seedVault(root)` + scaffold template constants |
| `src/constitution.ts` | enriched (edit) |
| `src/server.ts` | register `remember` + `list_capabilities` tools, with Geode-vault-framed descriptions (edit) |
| `src/index.ts` | call `seedVault(config.workspaceRoot)` after `workspace.init()` (edit) |
| `test/ingest.test.ts`, `test/capabilities.test.ts`, `test/seed.test.ts` | unit tests |
| `test/server.test.ts` | extend with the two new handlers (edit) |
| `test/e2e.manual.md` | extend with a `remember` + `list_capabilities` manual check (edit) |

## 6. Data flow

- **`remember`:** caller → `remember` tool handler → `remember(deps, {content, source})` →
  `delegate(deps, buildIngestInstruction(...))` → agent integrates into the vault, updates
  `index.md`/`capabilities.md`, commits → result returned (run-id, commit, files touched, summary).
- **`list_capabilities`:** caller → handler → `listCapabilities(root)` → read `capabilities.md`
  (or fallback) → returned. No agent run, no commit.
- **Startup:** `loadConfig` → `createWorkspace` → `workspace.init()` → `seedVault(root)` (idempotent
  scaffold + commit) → build deps → start server with `find`, `delegate`, `remember`,
  `list_capabilities`.

## 7. Error handling

- `remember` inherits `delegate`'s handling (busy/timeout/crash → structured tool error; git
  reset-on-failure; event log). Empty/whitespace `content` → a clear validation error before any run.
- `list_capabilities` on a missing `capabilities.md` → the friendly fallback note (not an error).
- `seedVault` failures (e.g. unwritable dir) → surfaced at startup, like other init failures.

## 8. Testing

- **Unit:** `buildIngestInstruction` (content+source+title → instruction shape, incl. no-source and
  no-title cases); `remember` (asserts it invokes `delegate` with the built instruction and returns its result,
  via fakes); `listCapabilities` (temp dir: returns file content; absent → fallback); `seedVault`
  (temp dir: creates the 3 files + commits; idempotent — a second call doesn't overwrite an edited
  file); the two new server handlers (like the existing `find`/`delegate` handler tests).
- **Manual e2e** (`test/e2e.manual.md`, extended): call `remember` with a learning → verify a commit,
  the content filed into a page, `index.md`/`capabilities.md` updated, an `ok` log entry; then
  `list_capabilities` returns the manifest. Live agent ingest quality is non-deterministic, so this
  stays manual.

## 9. Out of scope / deferred

- Autonomous **lint** (scheduled/triggered self-maintenance: contradictions, orphans, stale claims).
- `invoke` + integrations (#3/#5), dashboard (#4), multi-workspace (#6), the hosted/SaaS layer.
- Ambient auto-capture (an opt-in "save notable learnings automatically") — explicit `remember` only.

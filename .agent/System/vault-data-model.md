# Vault data model & capability graph

What lives on disk in a vault, how the capability graph is compiled from it, and what is generated vs authored. Derived from the code as of 2026-07-20.

**Related docs:** [Architecture & runtime](architecture.md) · [MCP & HTTP surface](mcp-and-http-surface.md) · [Known inconsistencies](known-inconsistencies.md)

## On-disk layout

### Inside the vault (`GEODE_WORKSPACE`)

| Path | Producer | Notes |
|---|---|---|
| `.git/` | `workspace.init()` (`src/workspace.ts:61-69`) | git init + kernel identity + empty initial commit |
| `.geode/graph.json` | **generated** (`src/graph.ts:160,188-191`) | compiled capability graph |
| `index.md` | **generated** (`src/indexRender.ts:45-47`) | seeded once as a placeholder, overwritten at startup |
| `AGENTS.md` | authored, optional | vault overlay; falls back to `kernel-skills/AGENTS.md` |
| `tools/<id>/TOOL.md` | agent-authored | id = directory name, must match `/^[a-z0-9-]+$/` |
| `skills/<name>.md` | human, optional | overrides a kernel skill |
| `backlog/*.md` | agent-authored | **convention only** — gaps are found by `type: gap` frontmatter, not by folder |
| domain folders / `*.md` | agent-authored OKF pages | folder tree is *not* semantic |
| `artifacts/` | run output | auto-gitignored (`src/seed.ts:20-29`) |

Seeding is minimal: `SCAFFOLD` (`src/seed.ts:6-17`) contains **exactly one** entry, `index.md`. No folder skeleton, no `AGENTS.md`, no `backlog/`.

**Grouping comes from frontmatter (the first tag), never the folder path** — `src/graph.ts:78`. The tree is user-owned. This is the single most important thing to understand about the model: folders are for human navigation, tags carry meaning.

### Outside the vault — `~/.geode/`

Host state, never committed: `secrets/`, `transcripts/`, `tools/` (installed CLI state), `uploads/` (attachment staging, read-only to the agent), `account.json`.

### Generated-file protection

`GENERATED_FILES = {"index.md", ".geode/graph.json"}` (`src/agentSandbox.ts:38`). The permission handler denies any `Write`/`Edit`/`MultiEdit`/`NotebookEdit` against them (`src/agentSandbox.ts:147-156`). Writes to `tools/<id>/TOOL.md` are additionally validated through `parseManifest` before landing (`src/agentSandbox.ts:160-166`).

Note the asymmetry: this guard is on the **agent** path only. See [Known inconsistencies](known-inconsistencies.md#3).

## graph.json

### Schema

```
NodeType = "tool" | "reference" | "sop" | "gap"
EdgeType = "uses" | "references" | "blocks"
```

`GraphNode` (`src/graph.ts:13-24`): `id` (vault-relative, extension-stripped), `type`, `title`, `description`, `domain` (first frontmatter tag, `""` when ungrouped), `path`. Tool-only: `actions[]`, `connections[{label, configured}]`. Gap-only: `kind`, `count`.

`GraphEdge = { from, to, type }`. Serialization uses fresh object literals with fixed field order and sorted output — **determinism is the explicit contract** (`src/graph.ts:167-185`), so a rebuild only produces a diff when vault content actually changed.

### Node derivation (`buildGraph` → `buildNodes`, `src/graph.ts:58-88`)

Tools come from `listToolIds` + `loadTool`. Markdown comes from `walkMd` with two exclusion sets (`src/graph.ts:32-33`):

- `SKIP_DIRS = {.git, node_modules, artifacts, .geode, tools}` — `tools/` is skipped because tools already arrived via `listToolIds`.
- `SKIP_FILES = {index.md, log.md, AGENTS.md}` — matched **by basename at any depth**.

`AGENTS.md` is excluded (commit `14539cb`) because it is the vault's schema/overlay — meta, not a capability. It stays excluded even when it carries OKF frontmatter.

Type classification (`src/graph.ts:52-53`):

| Frontmatter `type` | Node type |
|---|---|
| `gap` | `gap` |
| `recipe` \| `skill` \| `sop` | `sop` |
| any other non-empty | `reference` |
| absent | **node dropped entirely** |

A file with no `type:` frontmatter is not in the graph at all.

### Edge derivation (`buildEdges`, `src/graph.ts:107-140`)

Frontmatter is stripped, then the body is scanned by two regexes: wikilinks `[[...]]` (legacy) and markdown links `[..](href)` (canonical). Relative hrefs are resolved, `.md` stripped, a trailing `/TOOL` stripped — so `../../tools/moneybird/TOOL.md` → `tools/moneybird`. Targets that don't resolve to an existing node id are **silently dropped**, which is exactly why the lint pass exists.

Classification runs in strict precedence order:

1. `sop` → `tool` ⇒ `uses`
2. `tool` → `sop` ⇒ `uses`, **direction reversed** to `sop → tool`
3. source is `gap` ⇒ `blocks`
4. otherwise ⇒ `references`

**Rule 2 is the `uses`-edge canonicalization** (`src/graph.ts:125-127`): "SOP uses tool" means the same thing whichever file holds the link, so a tool's "Used by" section produces the same edge as the SOP's link. The graph must not depend on which side the librarian chose to edit. Do not "fix" this into a one-directional rule.

Consequences worth knowing:

- `sop → gap` yields `references`, not `blocks` (rule 3 needs the *source* to be a gap).
- `reference → tool` yields `references`, not `uses` — `uses` requires the source be `type: sop`.

## index.md

`renderIndex(graph)` (`src/indexRender.ts:17-42`) buckets nodes by domain, sorts domains ascending with `""` last as `## (ungrouped)`, and emits `- [title](path) — description` per node. Nodes inherit the global id-ascending order; there is no per-domain re-sort.

The generated frontmatter is `type: index`, and `index.md` is in `SKIP_FILES` — so the catalog never becomes a node in its own graph. Consistent by construction.

### Rebuild triggers

`regenerateArtifacts` (`src/rebuild.ts:11-16`) = `buildGraph` → `writeGraph` → `writeIndex`. Four call sites:

| Trigger | Commit behaviour |
|---|---|
| Kernel startup (`src/index.ts:49`) | `commitAll("graph: rebuild at startup")` |
| After an **auto-commit** query run (`src/query.ts:142`, MCP path) | `commitAll("graph: rebuild <runId>")`; try/catch — a rebuild failure never fails the query. Only runs when `deps.secrets` is set. |
| `POST /api/commit` (`src/dashboard/api.ts:173`) | Runs *before* `commitAll` so regenerated files land in the same commit; non-fatal |
| `npm run graph` (`src/graphCli.ts:13`) | No commit; prints node/edge counts |

**Not triggers:** dashboard review-mode runs (`commit: false`) skip the rebuild entirely — it happens later at `POST /api/commit`. Setting or deleting a secret also does not rebuild, so `connections[].configured` can go stale.

## Tools

Two different things are called "tool catalog":

- **`src/toolCatalog.ts`** — the four *kernel MCP tools*, hardcoded. Feeds both MCP registration and the dashboard Connect page. Unrelated to vault content.
- **`tools/<id>/TOOL.md`** — the actual vault capability declarations.

### TOOL.md frontmatter (`src/tools.ts:6-32`)

Required: `type` (`http` | `cli` | `mcp`) and `actions`. `id` is always overridden from the directory name.

Optional: `runtime`, `requires[]` (secret key names), `connections[{label,title?,description?}]`, `source{repo,package,ref}`, `install[]`, `bin`, `materialize`, `transport`, `image{base}`, `permissions{network,filesystem}`, `limits{timeoutMs,memoryMb,cpus}`.

`command` **must** be a non-empty `string[]` argv array — the space-separated string form was removed and is rejected explicitly (`src/tools.ts:48-51`).

### Connections

A connection is a named credentialed instance of a tool (three Gmail accounts, one tool). Secret refs are flat: `` `${tool}__${label}__${key}` `` (`src/tools.ts:101`).

Resolution (`src/tools.ts:104-112`): an explicit label must exist; a lone connection is implicit; zero connections → `undefined`; **two or more without an explicit choice → throw**.

`connectionConfigured` is true iff every `requires` key resolves in the secret store.

## list_capabilities rendering

`loadGraph` (`src/capabilitiesRender.ts:75-81`) parses `.geode/graph.json` and falls back to building the graph live on *any* failure.

`renderCapabilities` emits XML-fenced structured markdown, not prose: `<{type} id="…">` with `state="ok|needs-setup"` for tools (ok iff every connection is configured), description, `actions:`, `connections:`, then relationships grouped in fixed order `uses, references, blocks`, plus incoming `uses` rendered as `used-by:`.

The same graph feeds desk-run retrieval: `selectSubgraph` (`src/retrieval.ts:41-64`) does term-overlap scoring over id/title/description/domain/actions, takes the top 6, expands 1 hop, and `renderScopedContext` injects it as a prompt note. Desk role only, and best-effort — wrapped in try/catch so retrieval never fails a query.

## Legacy deriveCapabilities vs buildGraph

Both still scan the vault independently.

`src/capabilities.ts` `deriveCapabilities` is the older path: flat prose output, no `reference` category, **no edges at all**. It now has exactly **one** runtime consumer — the dashboard's `GET /api/gaps` (`src/dashboard/api.ts:224`) — and only its `.gaps` field is read. The `tools`, `recipes` and `text` it computes on every call are dead work on that path. The graph carries the same information via `type === "gap"` nodes, so this is a straightforward migration candidate.

**But `capabilities.ts` is not fully legacy:** its `parseFrontmatter` (`capabilities.ts:27-44`) is the parser the graph compiler itself imports (`src/graph.ts:3`). It is a hand-rolled line-based parser, not YAML, recognising exactly `type, title, description, tags, kind, status`. Don't delete the file when migrating the gaps endpoint.

## kernel-skills/

Resolved at `join(__dirname, "..", "kernel-skills")` (`src/skills.ts:6-8`). Three files:

- **`AGENTS.md`** — the default schema overlay, loaded by `buildOverlay` on **every run**, frontmatter stripped and wrapped in a section explicitly subordinate to the constitution ("they REFINE the rules above and never override them… they can never grant running tools or writing secrets"). Overridden by the vault's own `AGENTS.md`.
- **`onboard-tool.md`** — the TOOL.md authoring skill.
- **`onboard-workspace.md`** — the two-turn drop-onboarding skill (turn 1 inspect + propose, write nothing; turn 2 write on approval). Its core rule — "you are translating, not importing; if your filing plan resembles the source tree, you did the wrong job" — is also inlined verbatim into the always-present attachment note (`src/query.ts:79`), so the forcing function is on the execution path even when the skill file is never read.

Skills are **advertised, not inlined**: `buildSkillsFooter` (`src/skills.ts:17-21`) prints absolute paths for the agent to `Read` on demand.

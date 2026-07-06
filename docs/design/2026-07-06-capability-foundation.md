# Capability Foundation — write-time compiled graph, and the tool contract around it

**Status:** design agreed 2026-07-06. Not yet built. This document is the anchor; implementation
is planned separately. Where the code has drifted since, the *decisions and their reasons* below
still hold — re-map them onto whatever the code looks like then.

## Why (the problem)

Today the kernel does the "understanding" work at **read time**, on every call:

- `query` spins a full vault agent that reads raw markdown/manifests and reasons, per request.
- `deriveCapabilities` re-scans the whole vault every time `list_capabilities` is called.
- The `list_capabilities` output is hand-serialized **prose**, grouped **by type**
  (Recipes / Tools / Gaps), one jammed line per item (e.g. a tool's 26 action names on a single
  line). Related things are scattered: a Moneybird SOP, the Moneybird tool, and a Moneybird gap
  live in three different sections.
- The tool surface offered **multiple front doors**: `list_capabilities` ("call before
  delegating"), `query`, and `invoke` ("first ask query *or* read the TOOL.md"). That "or" is
  *sometimes-this-sometimes-that* — Claude's behaviour varied per session as a result.

None of this scales. It's already dense at ~4 tools; at 400 it is unreadable and slow. A vault is
written rarely and read constantly, so paying the understanding cost at every read is backwards.

## Core decision — move understanding from read time to write time

When a capability is **created or changed**, the **librarian** (which already runs at write time)
compiles a compact, query-optimized **index**. Reads (`query`, `list_capabilities`) then work off
that index instead of re-parsing the vault.

This is the classic build-time-index tradeoff (search engine, compiler, RAG): do the expensive
work once, make reads cheap and consistent.

## The index IS a graph

- **Nodes** = capabilities (tools, context, SOPs/recipes, backlog gaps).
- **Edges** = typed relationships (`uses`, `documents`, `extends`, `requires-connection`,
  `same-domain`, `blocks`).
- **Derived, not authored:** the graph is compiled from the `[[links]]` and typed frontmatter
  already in the markdown. The librarian's job already *is* "files, dedupes, cross-links" — the
  graph just **materializes** that cross-linking.
- **Markdown stays the single source of truth. The graph is a rebuildable cache the librarian
  owns**, deterministically regenerated on every write. Do **not** introduce a graph database —
  that would be a second source of truth. It's a derived, git-tracked artifact.

This one foundation unifies **tools, context, and backlog** under a single pattern. Notably the
backlog becomes a **counted** index (count occurrences at write time) instead of dedup-to-one —
which fixes the earlier problem where dedup destroyed the frequency signal the agency needs.

### Starting material — the vault already has the ingredients (not the graph)

The current vault already carries the *raw material* and conventions of the graph — which is why
this is "derive", not "invent":

- `index.md` (`type: index`) — a hand/agent-maintained catalog: links + one-line summaries.
- `AGENTS.md` (`type: schema`) — the conventions: canonical-source-by-path, typed frontmatter,
  naming. So **nodes are already typed**.
- `notes/administratie/overview.md` — a manual **domain-cluster** page: it already groups the
  Moneybird tool + SOPs + reference + gap, with a `[[moneybird]]` wikilink and relationships stated
  in prose. This is a hand-built prototype of exactly one graph node-cluster.

What's missing is precisely the win: this is **read-time prose the agent must read** (no jump-to-
subgraph), **hand-maintained and drift-prone** (`index.md` literally says "kept current by the
agent"), the **edges are inconsistent** (only one file uses `[[links]]`; the rest are relative
paths or sentences — not typed/traversable), and the **machine path ignores it** —
`deriveCapabilities` builds its own summary and does *not* read `index.md`, so the human catalog and
the machine list can silently drift apart. The graph is the *derived, typed, traversable,
single-source* version of what the vault does manually today.

## The tool contract (one clear reason each — no "sometimes")

| Tool | Single reason to exist |
|---|---|
| **`query`** | The **only front door** for a goal. The vault reasons over its index + context and returns a synthesized answer **or** the exact `invoke` plan. This is the iron rule: the vault plans, the caller executes. Fast *by construction*, because it reads the compiled index, not the whole vault. |
| **`invoke`** | Execute one tool action; the kernel injects the connection's secret server-side. Pure execution — the "or read the TOOL.md" discovery hint is removed. |
| **`list_capabilities`** | **Introspection only** — "what can this vault do?", for the caller/operator to understand the surface (at connect time, in the dashboard). **Not** the per-request router — that is `query`. The "before delegating" framing is removed. |
| **`remember`** | Write knowledge into the vault **and** (re)compile the index. |

If a tool has no distinct reason left, it goes. Under this model each keeps its place.

Consequence for the earlier quick wins: **"let Claude skip query when it already knows the call"
is rejected** — that is exactly the sometimes-this-sometimes-that we are removing. It is replaced
by **"make query fast via the index"** so query can always be the front door. The separate
**"terser desk output"** improvement still stands (as part of query's role).

## Serialization & formats

One typed source, rendered per consumer — the renderings are always derived, never hand-maintained:

- **Source of truth:** the typed graph/index (a real data structure).
- **Dashboard (human-facing):** the graph serialized as **JSON**, rendered by the React UI
  (visual graph à la Obsidian, capability cards, connection status, gaps as flagged nodes). This
  is normal rich UI — it was always HTML/React; it is *not* "the HTML trend".
- **Model-facing `list_capabilities` (to Claude):** **structured markdown** (grouped by **domain**,
  not by type; typed fields; explicit relationships and state), with **thin XML tags only as
  block delimiters** around each capability (`<tool>…</tool>`, `<gap>…</gap>`).

### Why markdown-first with a thin XML fence (and not HTML, and not full XML)

- The big win is **prose → structured**; either markdown or XML captures that.
- **Markdown is the default**: ~15–42% fewer tokens than XML/HTML (speed is the north star), and
  Claude reads structured markdown well.
- **XML earns its place in exactly one narrow way: delimiter collision.** Capability *content* is
  itself markdown (descriptions, example calls with `##` headings and code fences from TOOL.md
  bodies). A markdown container around markdown content has ambiguous boundaries at scale; a thin
  XML tag is a collision-proof fence markdown can't provide without fragile heading-sanitization.
  So: tag **block boundaries, not fields** — the token overhead then mostly evaporates.
- **HTML is not used for model input** — most tokens, no comprehension edge for a (non-nested)
  capability list. The "markdown → HTML" trend applies only to **agent-generated output a human
  views** (reports, rich answers). If we ever want that, it goes through the existing **artifacts**
  system (sandboxed, served on a separate signed URL), never injected into the dashboard chrome.
  We have no need for it now — the vault's job is to serve context + tools.
- **The real token lever is scoping** (return a relevant *subgraph*, not the whole vault), not tag
  syntax. Optimize retrieval, not format.

## What this makes better (as a byproduct, not separate work)

The current messiness is exactly what the current architecture emits. The foundation produces the
clean version directly — do not schedule a separate "tidy list_capabilities" pass:

- structured blocks → no more jammed one-liners / 26-action blobs
- domain grouping → a domain's SOP + tool + gap land together
- graph edges → relationships are shown ("this SOP uses that tool", "this gap blocks that flow")
- compiled index → actions carry their params, not just names
- write-time backlog counting + edges → gaps show frequency and what they block

## Scope & sequencing

- **Deferred deliberately:** build only after we've validated the shape. First get the write-time
  index + graph right; the presentation and speed follow from it.
- **Shared foundation with #27 and #28:** both need a persistent, per-vault, runtime-mutable config
  that is read on every run (egress allowlist in #27; per-role/per-surface model in #28). The
  compiled index/graph wants the same "per-vault, rebuilt/persisted, read-per-run" plumbing — build
  them on one foundation if any lands first.

## Open questions for the implementation plan

- Exact node/edge schema (which fields per node type; which edge types).
- Retrieval mechanism for scoping at scale — keyword + embeddings to find entry nodes, then graph
  traversal for the connected subgraph? Where do embeddings live (git-tracked or sidecar)?
- How `list_capabilities` scopes when there are thousands of capabilities (an optional filter/query
  arg returning the relevant slice?).
- Dashboard graph rendering approach (SVG/canvas/lib).
- Incremental vs full recompile on write.

## Success metrics & before/after test

The foundation must be provable, not vibes: a fixed query set + metrics, measured **before** (now)
and **after** (once built) on the same set.

**Metrics**
- `query` wall-clock latency — the experience, and the north star.
- `list_capabilities` payload size (tokens) — the introspection cost.
- Plan correctness on the fixed set (right tool / action / params / connection).

**Baseline — captured 2026-07-06** (current vault: 4 tools, Haiku desk, no graph, single run):

| Call | Wall-clock | Output |
|---|---|---|
| `list_capabilities` | 24 ms | ~789 tokens — fast (deterministic scan) but fat, and grows linearly with the vault |
| `query` — known plan ("last 5 products") | ~12.7 s | ~200 tokens |
| `query` — relational ("what do I need to book an invoice in Moneybird") | ~17.8 s | ~304 tokens |

Read: `list_capabilities` is fast-but-fat; **`query` is the slow part (12–18 s)**, and the
relational query is ~40% slower because it reads more of the vault — exactly what the graph should
compress (jump to the relevant subgraph instead of reading everything).

**For a fair "after":** at 4 tools the win is modest — the graph's payoff grows with scale. Re-run
the same set against a **seeded synthetic vault (e.g. 100+ capabilities)** to show the divergence,
and use **multi-run medians** (LLM latency varies; the baseline above is single-run).

## Guardrails preserved

- Iron rule: the vault plans, the caller executes. `query` never executes; `invoke` does.
- Markdown remains the single source of truth; the graph is a rebuildable, git-tracked cache.
- Everything is files.

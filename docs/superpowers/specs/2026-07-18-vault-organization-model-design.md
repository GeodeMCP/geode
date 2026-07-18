# Vault Organization Model: Graph vs. LLM-Wiki vs. Routing — Analysis & Recommendation

**Date:** 2026-07-18
**Status:** Draft (analysis + recommendation; not yet implemented). Source of truth for the next design round — safe to hand a fresh subagent/session as its brief.

## Why this exists

The vault started from two external patterns and later adopted a capability graph "for desk speed." Symptom that they are still mixed: onboarding an LLM-wiki drop produced ~20 **flat** files whose cross-links are `[[wikilinks]]` (the source's Obsidian syntax) while our stated convention is resolvable markdown links. The owner's constraint: **hundreds of files on one level is not acceptable.** This doc decides what to keep.

Origins:
- LLM-Wiki pattern — https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Content-Agent-Routing-Promptbase — https://github.com/RinDig/Content-Agent-Routing-Promptbase

## The three systems

**A. LLM-Wiki (karpathy).** `sources/` (immutable raw) + `wiki/` (LLM-maintained pages, **organized by category into subfolders**) + a `CLAUDE.md` schema. Meta: `index.md` (catalog by category), `log.md` (append-only changelog), and at scale **hierarchical `_index-{parent}.md`** ("the global index stays lean, lookup speed doesn't degrade"). Links: `[[wikilinks]]`. Navigation: read index → drill in; humans browse via Obsidian folder tree. Core: **compounding artifact** (synthesize once, accumulate) + a **lint pass** (orphans / contradictions / stale claims) to fight drift.

**B. Content-Agent-Routing (RinDig).** Four layers: L0 system prompt (folder map), L1 routing table (`CONTEXT.md`, task→domain), L2 per-folder `CONTEXT.md` (what to load), L3 content (selective section loading). Core: **routing ≠ content**, canonical sources, one-way dependencies, load only what's needed.

**C. Ours — the capability graph.** Flat OKF pages; links compiled into a typed graph (`uses`/`references`/`blocks`); generated `index.md` + `.geode/graph.json`; git = history; `backlog/` = gaps. The desk gets a **scoped subgraph** pre-selected from the query (the "desk speed" win).

## Where the two systems are mixed today

1. **Link syntax:** the compiler (`graph.ts` `buildEdges`) resolves BOTH `[[wikilinks]]` (A) and `](markdown)` (C). Agents drift toward whichever the source used.
2. **Index model:** A = hand/LLM-maintained hierarchical catalog; C = generated flat-per-domain index.
3. **History:** `log.md` (A) vs git (C). Already resolved → git.
4. **Organization:** folders-by-category (A **and** B) vs flat + graph-links (C, over-corrected this session).
5. **Routing:** hand-maintained `CONTEXT.md` (B) vs automatic scoped subgraph (C).

## Recommendation — what to keep

**Keep the capability graph as the core retrieval/routing engine.** It is an *automated* version of B's routing layer: what RinDig hand-maintains in `CONTEXT.md` files, our graph derives from links. So keep the graph; **do not build B's manual routing files.** B's principles (canonical source, one-way deps) already live in our vault model.

**Fix the flat-files mistake.** We conflated "don't mirror the source's folders" with "no folders." Both A and B organize by folders/hierarchy, and A explicitly uses **hierarchical indexes** to stay navigable at scale — so the owner's instinct matches both sources. The correct lesson from the mirror problem is *don't blindly copy the source tree*, not *never use folders*.

- **Re-allow shallow, meaning-based domain folders** (1–2 levels, grouped by concept, not by the source tree) once a domain grows. Folders = coarse human navigation; the graph = fine machine traversal. Complementary, not competing. This is the direct fix for "hundreds of files flat."
- **Make the generated index hierarchical** (group by domain; per-domain sub-index at scale) — A's scaling trick, but generated rather than hand-kept.

**Adopt from A: a lint / health pass** — orphan detection (a graph node with no edges), contradiction flagging, stale-claim checks. The graph makes orphan detection trivial. We don't have this; it is the strongest single "keep" from the wiki.

**Resolve the mixing: pick one link syntax.** Recommend **markdown relative links** as canonical (portable — works in any renderer/GitHub, fits the tool-agnostic/exportable value prop; wikilinks are Obsidian-specific). Keep the compiler's `[[…]]` tolerance only as a safety net, not the norm; the librarian must convert a source's wikilinks on ingest.

## Open forks (decide before/inside implementation)

- **Link syntax** — markdown (recommended, portable) vs. embrace wikilinks. Pick one and enforce it consistently in the prompt + a lint check.
- **Raw sources / bulk data (residual #2).** A *keeps* raw sources (immutable, for provenance/re-derivation); we currently *translate and discard*. This is the real question behind "where do CSV/JSONL/raw files go." Decide: pure synthesized graph (concepts only) vs. a provenance layer that keeps raw sources. This determines whether a `raw/` or `data/` area is legitimate.

## Suggested sequencing (each a subagent-sized slice)

1. **Shallow folders + hierarchical generated index** — fixes the owner's immediate irritation; smallest high-value slice. Touches the vault model (allow shallow meaning-based folders) + `indexRender.ts` (hierarchical/domain-grouped output).
2. **Link-syntax normalization** — pick markdown; prompt says convert wikilinks; add a lint check for stray `[[…]]`.
3. **Lint / health pass** — orphans + stale + contradictions over the graph; surfaced in the dashboard.
4. **Raw-sources decision** — resolve the fork, then place bulk data accordingly.

## What is already done (context, on `main`)
Meta-layer minimal design (one generated index, git history, no `log.md`/`MEMORY.md`); attachment fix + read-content-is-data; the "translate don't mirror" prompt arc (canonical "The vault model", forcing function inlined in the attachment note, content-vs-bookkeeping loophole closed). See [[vault-meta-layer-minimal-design]] and [[attachment-staging-and-authority-boundary]] in memory.

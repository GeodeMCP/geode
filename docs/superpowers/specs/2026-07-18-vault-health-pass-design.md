# Vault Health Pass — Design

**Date:** 2026-07-18
**Status:** Approved, ready to implement. Slice 3 of the vault-organization roadmap (`2026-07-18-vault-organization-model-design.md`).

## Why

The capability-graph compiler silently drops unresolved links. In `buildEdges` (`src/graph.ts`), a `[[wikilink]]` that resolves to nothing and a markdown link whose target isn't a graph node are both just skipped — no edge, no warning. A dead link therefore breaks retrieval **invisibly**: the page it should reach is unreachable and nobody sees it. There is no way for the human (the workshop) or CI to see this structural rot. This slice adds a deterministic health pass over the vault.

## Scope — three deterministic checks

1. **Stray wikilinks** — pages still using `[[wikilink]]` syntax (canonical link form is a resolvable relative markdown link). Already implemented: `findStrayWikilinks` (`src/lint.ts`, slice 2).
2. **Orphan nodes** — a `reference`|`sop` graph node with **zero edges** (nothing links it, it links nothing) → unreachable via the graph. **Exclude `tool` and `gap` nodes**: a freshly-added tool no SOP uses yet, and a gap, are legitimately unlinked and are not defects.
3. **Broken links** — a relative markdown link whose **target file does not exist on disk**. This is a *filesystem* existence check, not a node-existence check: a link to a real file that happens not to be a typed node (no `type` in frontmatter) is **not** broken. Skip external URLs (any `scheme://`), `mailto:`, and pure `#anchor` links; strip a trailing `#anchor` before resolving. (Stray `[[wikilinks]]` are already covered by check 1, so broken-link detection is markdown-only.)

Aggregated by a pure engine `lintVault(root, secrets) → VaultHealth`.

## Surfacing

- **CLI** `src/lintCli.ts`, mirroring `src/graphCli.ts`: load config + secrets, run `lintVault`, print an English report, **exit non-zero** if any category is non-empty. Usable by CI, a pre-commit hook, and the human from a terminal.

## Explicitly deferred (NOT this slice)

- **Contradictions & stale-claim checks** — semantic (two pages that disagree; a claim gone stale). These need an LLM/agent pass, not a pure lint; they belong with the librarian. Separate future slice.
- **Dashboard health panel** — the workshop surface where the human sees vault health. Its own slice (3b), once the engine output shape is proven; it needs UI design (placement, on-load vs on-demand, how findings render).

## Shape / interfaces

Extend `src/lint.ts` (keep the existing `findStrayWikilinks` / `StrayWikilink`):

```ts
/** A relative markdown link whose target file does not exist on disk. */
export interface BrokenLink { path: string; link: string }

/** A reference|sop node with no edges — unreachable via the capability graph. */
export interface OrphanNode { id: string; path: string }

/** Aggregated deterministic health findings for a vault. */
export interface VaultHealth {
  strayWikilinks: StrayWikilink[];
  orphans: OrphanNode[];
  brokenLinks: BrokenLink[];
}

export async function findBrokenLinks(root: string): Promise<BrokenLink[]>
export function findOrphanNodes(graph: VaultGraph): OrphanNode[]
export async function lintVault(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultHealth>
```

- `lintVault` builds the graph once (`buildGraph`) for orphan detection, and runs `findStrayWikilinks` + `findBrokenLinks`.
- `src/lintCli.ts` — thin wrapper (copy `graphCli.ts`'s config/secret loading).

## Constraints

- **Do NOT change `graph.ts`'s compiler behavior / wikilink tolerance.** `lintVault` consumes `buildGraph`'s output; it does not alter it.
- Deterministic output — sort every result list by path (then by link/id), matching `graph.ts` conventions.
- **JSDoc on every new export** (pre-commit gate blocks otherwise).
- English-only strings (CLI output included).
- TDD: extend `test/lint.test.ts` with temp-dir fixtures for orphans, broken links, and `lintVault` aggregation. Full suite green.

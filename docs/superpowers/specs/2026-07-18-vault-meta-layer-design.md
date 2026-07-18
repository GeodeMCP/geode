# Vault Meta-Layer: Minimal, Function-Justified File Set — Design

**Date:** 2026-07-18
**Status:** Draft (design approved in brainstorm; pending spec review)

## 1. Problem

The vault has accumulated several overlapping "meta" artifacts on top of the
canonical OKF content: `.geode/graph.json`, `index.md`, `log.md`, `AGENTS.md`, and
(newly, agent-created) `MEMORY.md` + `memory/`. These represent **three overlapping
indexes**, **two overlapping histories**, and **two overlapping rulebooks**.

The overlap is not benign — it drifts. Observed on 2026-07-18:

- A reorg (14:22) moved the administratie files but did **not** regenerate `index.md`;
  the hand-maintained `index.md` kept pointing at dead `business/administratie/…` paths
  until a kernel **startup** rebuild (14:37) silently corrected it — ~15 minutes of a
  stale, internally inconsistent index.
- The agent (running Haiku) **hand-edited `index.md`** (`Write` ×2 in the 14:30 run),
  directly against its own constitution rule ("index.md is generated … never edit it by
  hand"), and self-committed with `git commit` via Bash.
- Structural renames (`notes→business`, `epicwpsolution→epicwpsolutions`) got **no**
  log entry; delete entries landed a commit late.
- `MEMORY.md` + `memory/` were created by the agent copying a foreign pattern (Claude
  Code's own memory system) into the vault, where nothing consumes it.

Root causes, precisely located:

1. **Behavioral:** the agent hand-edits generated files; nothing enforces the
   "generated, do not edit" rule (it lives only in the prompt, which small models ignore).
2. **Wiring:** dashboard runs execute in review mode — `index.ts:102` passes
   `commit: false`, and `query.ts:115-118` returns **before** the rebuild block
   (`query.ts:132-135`). So the post-commit `writeIndex` regeneration never fires on the
   path where mutations actually arrive; only startup regenerates. Evidence: **zero**
   `graph: rebuild run-N` commits on 2026-07-18, only two `graph: rebuild at startup`.

## 2. Consumers (locked decision)

The design criterion falls out of who actually reads the vault:

| Consumer | How | Reads raw `.md` meta-files? |
|---|---|---|
| **Owner (human)** | via the **dashboard** | No — dashboard renders from `graph.json` and the transcript store |
| **External AI tools** | via **MCP** (`list_capabilities`, `query`) | No — MCP serves from `graph.json` |
| **Export ("one day, elsewhere")** | opening the exported **git repo** | **Yes** — this is the only reader of the plain files |

**Conclusion:** at runtime, both consumers run entirely on `graph.json`. The Markdown
meta-files exist **only to make an exported repository self-explaining without the
kernel.** Any meta-file with no runtime reader **and** no export role is dead weight.

## 3. The unifying principle

> `graph.json` is the runtime index. The Markdown meta-files exist to make an exported
> repo self-sufficient. **No tracked file is a hand-maintained derivative** — every file
> is either canonical (hand-authored source) or generated (rebuilt from the source).

## 4. Per-artifact decisions

| Artifact | Runtime reader | Export role | Decision |
|---|---|---|---|
| OKF content (`business/`, `tools/`, `backlog/`) | source of the graph | source | **Canonical** — hand-authored |
| `AGENTS.md` | per-vault overlay injected into the agent prompt | portable rulebook | **Canonical** — hand-authored; keep one rulebook, fix staleness |
| `.geode/graph.json` | dashboard + MCP index | prebuilt index (rebuildable) | **Generated** — never hand-edited |
| `index.md` | none | human/agent catalog without the kernel | **Generated** — never hand-edited; export view only |
| `log.md` | **none** (write-only) | duplicates git | **Remove** (§5) |
| `MEMORY.md` + `memory/` | **none** | none | **Remove** — foreign pattern, no consumer |

Verification backing the "no reader" claims: `graph.ts:33` `SKIP_FILES` excludes both
`index.md` and `log.md` from the graph; the only `log.md` references in `src/` are
writes (`eventLog.ts` append, `constitution.ts:6` + `query.ts:89` instructions to write);
the dashboard's history comes from `transcripts.list()` (`dashboard/api.ts:134,177`),
not `log.md`; the `remember` MCP tool files OKF notes into vault content, not `memory/`.

## 5. History & the `log.md` decision

**Decision: retire `log.md`. The export unit is the git repository; git is the history.**

- Nothing reads `log.md` — it is write-only, and it duplicates two things that *do* have
  readers: **git** (per-change message + diff) and the **transcript store** (what the
  dashboard shows).
- It is a primary drift source: a mash-up of machine-appended `## [ts] run-N` blocks and
  hand-written prose lines, with entries that lag or go missing.
- The "why" belongs in the **commit message** (the kernel already writes descriptive ones).
- If a git-less "bare files" export is ever needed, generate a disposable `HISTORY.md`
  from `git log` **at export time** — never a tracked, hand-maintained file.

## 6. Enforcement (makes "generated ≠ hand-edited" true)

Three mechanisms; the first two together close both root causes from §1.

1. **Guardrail (behavioral fix).** In the permission handler (`agentSandbox.ts`,
   `buildPermissionHandler`), **deny `Write`/`Edit`/`MultiEdit`/`NotebookEdit` to
   `index.md` and `.geode/graph.json`** with a message: "generated from the vault graph;
   it is rebuilt automatically — do not edit." This holds regardless of which model runs.
2. **Rebuild on every commit path (wiring fix).** Ensure the graph + index rebuild runs
   whenever vault content is committed, **including the dashboard review-mode commit
   path**, not only at startup. (Today the rebuild block after `query.ts:135` is skipped
   by the review-mode early return.)
3. **Drop the log rule and the vault-side run log.** Remove "After any change, append a
   concise line to log.md" from `constitution.ts:6` and the "keep log.md current"
   instruction in `query.ts:89`. The commit message is the vault's history.
   **Retarget run telemetry:** today `eventLog.append` writes every run's
   instruction/result into `log.md` (`query.ts:122,153`), while the machine-local
   transcript store is written **only on the dashboard path** (`api.ts:143`) — so MCP
   runs live *only* in `log.md`. Unify both onto the machine-local transcript store
   (append MCP runs there too) and delete the `eventLog`→`log.md` writer. Run
   instruction/result pairs are machine-local telemetry, not git-tracked vault content.

## 7. Migration

- Delete `log.md`, `MEMORY.md`, `memory/` from the vault (single housekeeping commit;
  git retains their history).
- Regenerate `index.md` from the graph so it is canonical-generated again.
- Update `AGENTS.md`: correct the folder map to the current structure
  (`business/shared-knowledge/`, `business/mijnwebontwikkelaar/`,
  `business/epicwpsolutions/`); add the fact that `index.md` and `.geode/graph.json`
  are generated and must not be hand-edited.

## 8. Out of scope

- Whether `graph.json` should be committed vs `.gitignore`d — keep it committed (prebuilt
  index travels with the export); revisit only if commit noise becomes a problem.
- The desk-URL-fetch constitution change (separate, already implemented and verified).
- Any redesign of the capability-graph compiler or retrieval.

## 9. Success criteria

- After any dashboard-driven change, `index.md` reflects the change **in the same
  committed state** (no stale window until the next restart).
- An attempt by the agent to `Write` `index.md` or `graph.json` is denied.
- `log.md`, `MEMORY.md`, `memory/` are gone; no code references them.
- The vault contains exactly: canonical content + `AGENTS.md` (hand-authored), and
  `index.md` + `.geode/graph.json` (generated). Every remaining file has a named reader
  or a stated export role.

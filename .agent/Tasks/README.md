# Tasks — PRDs & implementation plans

**Per-feature specs and plans are not duplicated here.** They already live in `docs/`, organised by date, and that is where they stay:

- **`docs/superpowers/specs/`** — design specs, one per feature, dated. 36 files.
- **`docs/superpowers/plans/`** — matching implementation plans. 31 files.
- **`docs/plans/`** — 5 more plans, the capability-graph foundation (graph compiler, generated index, desk/librarian split, list_capabilities, scoped retrieval). Separate directory, same purpose.
- **`docs/design/`** — visual style spec and canonical dashboard mockups.
- **`docs/README.md`** — the north-star architecture index and value prop.

Each feature follows **spec → plan → build**.

## Read these as history, not as current state

A spec records what was decided on a date. Several now describe a system that has since changed — the capability-graph compiler, the meta-layer rationalization (`log.md` removed), the health-pass lint, and the constitution rewrites all landed after their neighbouring specs were written.

**When a spec and `.agent/System/` disagree, `System/` is right.** It is derived from the code.

Two specific traps:

- `docs/superpowers/specs/2026-07-01-agent-sandbox-design.md:157` claims a `WebFetch`/`WebSearch` deny that no longer exists.
- Anything describing `log.md` as part of the vault model is stale — it was removed entirely.

## Current direction

- `2026-07-18-onboarding-gaps-roadmap.md` — the six gaps exposed by the SupportPal stress test.
- `2026-07-03-vault-workshop-onboarding-design.md` — the drop-a-folder onboarding work.
- `2026-06-26-mcp-caller-surface-eval-design.md` — the eval harness for the caller-facing tool surface.
- `2026-07-18-vault-organization-model-design.md` — graph vs wiki vs routing; slices 1–3 merged, hierarchical index and semantic checks still open.

## Open threads not captured in a spec

Tracked as GitHub issues rather than dated specs:

- **#6** multi-workspace / per-run worktree isolation — also resolves the unused `workspace` MCP param
- **#27** restore the `WebFetch`/`WebSearch` deny behind a chat approval flow
- **#38** managed vaults & account separation (vault ≠ account)
- **#4** profile-dir credential materialization (throws today)
- **#3b-2** stdio MCP transport (throws today)

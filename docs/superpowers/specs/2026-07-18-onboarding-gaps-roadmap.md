# Onboarding stress test (SupportPal) — findings & gap roadmap

**Date:** 2026-07-18
**Status:** Source of truth for the next design round. The vault was rolled back; these are the real gaps to close.

## What happened

A real folder was dropped: a **SupportPal ticket export** for Epic WP Solutions — 310 raw ticket JSON files + 2 aggregate JSONs + a `.env` (live `SUPPORTPAL_API_TOKEN`) + `.gitignore`. The onboarding failed on almost every axis:

- **Run 1 (plan, strong model):** proposed a reasonable plan — synthesize the 310 tickets into a few pages, keep raw only as a "data-only manifest", treat `.env` as a tool + secret.
- **Run 2 (execute on "Yes", Haiku 4.5):** its own thinking states the approved plan was *"cut off"* from context, so it **reconstructed a worse plan** and `cp *.json` — 310 raw files dumped flat under `business/epicwpsolutions/support/`, plus one `supportpal-archive.md` and a non-executable `tools/supportpal/TOOL.md`.
- **Run 3 (owner asked the agent to nest):** moved the 310 into `support/tickets/{sales,technical-support,unclassified}/`.
- **Runs 4–5 (MCP `query`):** returned an empty envelope to the caller, yet server-side ran as a **write** — created an "analysis" page and committed a graph rebuild.

Rolled back to `f7dbbb8` (last clean commit); PII + token purged from git history (reachable blobs = 0), staging, and transcript. **Token must be rotated** (it was in git/transcript/logs before the scrub).

## The gaps

| # | Gap | Symptom | Root cause | Type |
|---|---|---|---|---|
| 1 | **Plan-handoff turn1→turn2** | The good plan was discarded; executor improvised a worse one | The approved plan is not reliably present in the execution turn's context (executor reported it "cut off") | kernel — highest leverage |
| 2 | **Bulk / raw-data policy** | 310 raw JSON dumped into the vault, flat | No rule governs non-OKF bulk data; the shallow-folders guidance targets *pages*, so it didn't fire. This is the parked slice-4 fork, now live | design — owner's call |
| 3 | **Credential capture** | `tools/supportpal/TOOL.md` has a bare `actions:` list, no `connections:`/`requires:`; the source `.env` secrets never entered Geode's secret+connection model | Onboarding doesn't route source credentials into a proper connection declaration (contrast the moneybird tool) | kernel + constitution |
| 4 | **Artifact rebuild not atomic with the agent's own commit** | The onboarding commit shipped a stale `index.md`/`graph.json` (no supportpal); routing was stale until a *later* run rebuilt it | The librarian commits directly via `git commit` (bash), bypassing the kernel's rebuild-on-commit path (which is wired to dashboard `/commit` + post-run only) | kernel |
| 5 | **MCP `query` broken** | Returned an empty envelope (no answer/plan) to the caller AND wrote + committed a page — a "query" should be read-only desk | Query path surfaces no answer to the MCP caller; and it ran as a write/librarian op | kernel — needs its own investigation |
| 6 | **PII / secret blindness** | 310 tickets (customer PII) + per-ticket tokens committed to vault git, despite the source `.gitignore` explicitly warning "raw ticket dumps may contain PII; do not commit". The health-pass reported clean — it only sees markdown | No ingest-time PII/secret guard; the lint is blind to non-markdown bulk | safety + lint |

## Recommended sequencing

**Start with the design decision (#2), because it defines what "correct onboarding" even means** for anything that isn't a tidy set of prose pages. Options to weigh: (a) synthesize-and-discard (concepts only, raw never enters the vault); (b) a designated `data/` area that is nested + gitignored + PII-scrubbed for provenance. Until this is decided, the executor has nothing to aim at.

Then the executor/pipeline fixes that make the agent hit that target:
- #1 plan-handoff (so the approved plan is actually executed),
- #3 credential capture (source `.env` → connection + secret declaration),
- #6 ingest PII/secret guard + extend the health-pass to see non-markdown bulk.

In parallel, two separable kernel bugs:
- #4 make the rebuild atomic with any commit the agent makes,
- #5 fix the MCP `query` path (read-only + actually return the answer).

## Security follow-up
- **Rotate `SUPPORTPAL_API_TOKEN`** — assume compromised (was in git history, transcript, logs before scrub).

# .agent — project documentation index

Start here before planning any implementation.

Documentation lives in **two** places, deliberately:

| Tree | Holds | Nature |
|---|---|---|
| **`.agent/`** | current-state system docs, procedures | kept in sync with the code |
| **`docs/`** | dated design specs, implementation plans, mockups, north-star architecture | point-in-time history |

**When the two disagree, `.agent/System/` is right** — it is derived from the code. `docs/` records what was decided on a date and is not retroactively corrected.

## System — current state

| Doc | What it covers |
|---|---|
| [Architecture & runtime](System/architecture.md) | What Geode is, the run lifecycle, prompt layering, concurrency, full env config |
| [MCP & HTTP surface](System/mcp-and-http-surface.md) | Every MCP tool and HTTP route, the three auth schemes, hardcoded limits |
| [Vault data model](System/vault-data-model.md) | On-disk layout, `graph.json` schema, edge rules, `index.md` generation, rebuild triggers, TOOL.md |
| [Security model](System/security-model.md) | Secret broker, the three `invoke` executors, agent vs container confinement, OAuth |
| [Dashboard & frontend](System/dashboard-and-frontend.md) | Session auth, SSE, attachment staging, the commit model, transcripts, the React app |
| [Known inconsistencies](System/known-inconsistencies.md) | Confirmed bugs, bypasses, stale claims and dead weight found in the 2026-07-20 scan |

## SOP — procedures

| Doc | When |
|---|---|
| [Run locally](SOP/run-locally.md) | Starting the kernel; the `.env` and stale-port traps |
| [Verify sandbox](SOP/verify-sandbox.md) | Before every production deploy |

## Tasks

[Tasks/README.md](Tasks/README.md) — points at `docs/superpowers/specs/`, `docs/superpowers/plans/` and `docs/plans/`, flags which specs are stale, and lists open threads tracked as issues rather than specs.

## The one thing to internalise

> **The caller performs; the vault supplies.**

The vault gives context and *prepares* tool calls; the caller executes them. The internal agent is inward-only — it organises the vault and never calls integrations. Everything actionable funnels through `invoke`, where the server injects the credential so no caller ever sees a secret.

Changes that let the agent act on the outside world break the model, not just a test.

## Keeping these current

After a feature or bugfix, update the affected `System/` doc in the same change. The docs cite `file:line` throughout — those references rot, so when you touch a cited line, check the citation.

`System/known-inconsistencies.md` is a **snapshot, not a backlog**. Writing something there fixes nothing; delete an entry when it is genuinely resolved, and re-scan periodically rather than trusting the list to stay accurate.

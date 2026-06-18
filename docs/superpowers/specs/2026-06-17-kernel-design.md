# Kernel — Design Spec (Sub-project #1)

> **Updated 2026-06-18:** the agentic tool `delegate` is renamed **`query`** and the mechanical
> `find` tool is **removed** (all context access goes through `query`) in the v1-core completion cut
> (`2026-06-17-secret-broker-design.md`). This doc records the kernel as originally built; the
> architecture doc + #3 spec hold the current surface.

> Status: **Draft (brainstorm output, 2026-06-17), approved-but-not-frozen.**
> The kernel is the foundation: an MCP web service that serves a git-backed workspace
> through a cheap retrieval surface and an embedded agent. See
> `2026-06-17-context-vault-architecture.md` for the wider system and the three-operation
> model (`find` / `invoke` / `delegate`).

## 1. Purpose & scope

The kernel proves the core magic: **external call → context, via either cheap retrieval or
a delegated agent run.**

In scope: the git-backed workspace + two operations — **`find`** (cheap retrieval) and
**`delegate`** (the agent-in-the-middle) — over HTTP.
Out of scope (later sub-projects): **`invoke`** (proxied integration-action calls — needs the
secret broker #3 + integrations #5), **`remember`** (ingest — #2), the autonomous
reorganization and dashboard chat (door B), the integration installer, multi-tenancy.

Note: because `delegate` runs a *full* agent, it can already call connections **internally**
when they are configured — the standalone, caller-orchestrated `invoke` surface is what comes
later.

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Distribution | OSS self-host, single-tenant; must not preclude a future hosted layer |
| Tool surface | **`find`** (read/list/search) + **`delegate`** (agentic). `invoke` later with the broker. |
| Engine | Claude Agent SDK, embedded **in-process** (TypeScript) |
| Model | Model-connector config + base-URL seam (local + cloud, any choice) |
| Transport | **HTTP-first** web service (MCP over HTTP/SSE) + optional local stdio |
| Response model | **Synchronous + live progress** (MCP progress notifications) |
| Permissions (`delegate`) | **Full agent** (read/write/bash/tools), git-protected; config knob to tighten |
| Concurrency | Single-flight (one agent run at a time) |
| Versioning | Git-backed workspace; commit on success, reset on failure |
| Language | TypeScript / Node |

## 3. Architecture & data flow

```
  EXTERNAL CLIENTS                      THE KERNEL (web service)
  Claude Code ─┐
  Cursor ──────┼── HTTP/SSE + token ──▶ MCP server (HTTP-first)
  ChatGPT ─────┘                        • auth (bearer token)
       ▲                                • find(path/query[, workspace])   — cheap
       │ result + progress              • delegate(instruction[, workspace]) — agentic
       └──────────────────────────────────────┬──────────────────┐
                                               ▼ (delegate only)   │ progress + result
                                       Agent engine (Claude Agent SDK)
                                       • model via model-connector / base-URL seam
                                       • tools: read, write, bash, tool-calls (full agent)
                                               │ reads / writes
                                               ▼
                                       Workspace (git-backed)
                                       • your context: files / scripts / recipes / …
                                       • each delegate run = 1 commit
                                       • event log (append-only)
```

- **`find`** is the cheap path: it reads/lists/searches the (workspace-scoped) directory and
  returns raw data. No agent run, no extra model cost, low latency. The caller reasons itself.
- **`delegate`** is the expensive path: a fresh agent run does the whole task.

Flow of one `delegate`:
1. Client calls `delegate("do X")` over HTTP with a bearer token.
2. The MCP server checks the token, takes the instruction, and enqueues a run
   (**single-flight** — one active run; extras wait in a short FIFO; full queue → "busy").
3. The engine starts a **fresh run** in the (workspace-scoped) directory, with the model from
   the connector. It reads the dir as its memory; may traverse, run bash/scripts, call tools,
   and write.
4. It streams **progress** back to the client during the run.
5. On finish: commit changes to git, append a line to the event log, return the **final
   result** (text + metadata: files touched, commit hash, run-id) over the open connection.

## 4. Tool surface

**`find`** — cheap retrieval.
- *In:* a path and/or query, `workspace` (optional). *Out:* file contents / listing / search
  hits. Read-only, fast, deterministic. (Implemented as read / list / search.)

**`delegate`** — the agent-in-the-middle.
- *In:* `instruction` (natural language, required); `workspace` (optional string) — the
  first-class seam for multi-workspace, defaulting to the single/soft workspace for now.
- *Out:* final result as text + metadata (files touched, commit hash, run-id).
- *During:* progress updates via MCP progress notifications.

No `list_capabilities` tool yet (the curated manifest is a #2 convention; `find` covers raw
navigation). The full operation surface is `find` / `invoke` / `delegate` / `remember` +
`list_capabilities` (see the architecture doc); the kernel ships `find` + `delegate`. `invoke`
arrives with the broker (#3) / integrations (#5); `remember` with the ingest workflow (#2).

## 5. Components

| # | Component | Responsibility |
|---|---|---|
| 1 | MCP server (HTTP) | Exposes `find` + `delegate` over HTTP/SSE, checks bearer token, plumbs progress. (+ optional stdio adapter.) |
| 2 | Run manager | Single-flight queue for `delegate`: serializes runs, assigns `run-id`, manages lifecycle, enforces max-runtime. |
| 3 | Engine adapter | Wraps the Claude Agent SDK: starts a session in the workspace, sets system prompt + permissions + which MCP servers the agent itself may use, streams progress. |
| 4 | Model connector | Resolves model config (base-URL/auth/model-id/flags); presets for Anthropic / Bedrock / Vertex / Ollama / LiteLLM. The local+cloud guarantee layer. |
| 5 | Workspace + git | The context dir; `git init`; commit per delegate run; reset on failure; recoverability. `find` reads from it directly. |
| 6 | Event log | Append-only line per delegate run: run-id, time, instruction, result summary, commit hash, status. |
| 7 | Config loader | Env + config file: model connector, workspace path, auth token, permission profile, port. |

## 6. Tech stack

- **Node.js (LTS), TypeScript.** One language for kernel + future dashboard.
- `@anthropic-ai/claude-agent-sdk` (engine), `@modelcontextprotocol/sdk` (MCP, with the
  Streamable HTTP transport).
- Git via shell-out.

## 7. Runtime & model connector

The engine never hardcodes a provider. The connector sets, per the architecture doc:
`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` for any Anthropic-compatible endpoint
(Anthropic, Ollama ≥0.14.0 native, LiteLLM for OpenAI-format & cloud providers), or the
native Bedrock/Vertex flags. Caveats: `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` for
Bedrock/Vertex; do not leave a conflicting `ANTHROPIC_API_KEY` set; pin a clean LiteLLM.

## 8. Transport & auth

- HTTP-first MCP service (Streamable HTTP), reachable by Claude Code, Cursor, ChatGPT, and
  later the dashboard. Optional local stdio adapter for same-machine convenience.
- Auth: a single static **bearer token** from config (it is your endpoint). OAuth/multi-user
  is explicitly the hosted layer, later.

## 9. Response model

`find` returns synchronously and immediately. `delegate` is synchronous with live progress:
the connection stays open, the engine streams progress notifications during the run, and the
final result returns at the end. A configurable **max-runtime** caps truly long runs.

## 10. Permissions

`find` is read-only. `delegate` is a full agent: read, write, bash, tool-calls — all
git-tracked and therefore recoverable. Trust model: it is your endpoint behind a token
(single-user self-host). A config knob exists to tighten later (toward the architecture's
scoped/configurable profiles).

## 11. Concurrency & git

- **Single-flight:** one active `delegate` run; extras wait in a short FIFO; a full queue
  returns a structured "busy" error. (`find` is read-only and not gated by the queue.)
- **Git as safety net:** workspace is clean before a run. On **success** → `git commit` with
  run-id + summary. On **failure/crash** → `git reset --hard` to the last good commit, so the
  workspace is never left half-mutated. Git history = a sequence of recoverable, successful
  states.

## 12. Event log (kernel-minimal)

Append-only file; one line per delegate run (run-id, timestamp, instruction, result summary,
commit hash, status). The rich event-feed UI is the dashboard (#4); this is the debuggable
trail.

## 13. Config

Env + config file: model connector (provider/base-URL/auth/model-id/flags), workspace path,
auth token, permission profile, HTTP port, max-runtime, queue depth.

## 14. Error handling

| Case | Behavior |
|---|---|
| Auth failure | 401, clear message |
| Kernel busy / queue full (`delegate`) | structured "busy" error |
| Model unreachable (e.g. Ollama/base-URL down) | clear error + hint, logged |
| Agent run crash | workspace reset to last commit, failure event logged, error + progress trail returned |
| Run timeout | abort, reset, log, return timeout error (covers the sync-timeout risk) |
| Long runs | progress notifications keep the connection alive |
| `find` on missing path | clear not-found error |

## 15. Testing strategy

Layered, because agent output is non-deterministic:
- **Unit tests** on the deterministic scaffolding: tool registration, auth check,
  request/response framing, progress plumbing, run-manager queue/single-flight, git
  commit/reset, config + connector resolution, and `find` (read/list/search). The engine is
  mocked.
- **Integration test** with a real-but-cheap model against a **fixture workspace**: assert
  invariants for `delegate` (a commit was created, the log grew, result is non-empty, no
  exceptions) — not exact agent output.
- **Dogfood** as the real validation: call it from Claude Code against your own context.

## 16. May feed back into this spec

- The `workspace` parameter and workspace-scoping detail (from multi-workspace #6).
- The system prompt content = the constitution's immutable core (from context tools #2).
- The permission profile shape (from the secret broker #3, scoped/hard isolation).
- The standalone `invoke` surface and how integrations are exposed (broker #3 / integrations #5), plus the `remember`/ingest tool (#2).

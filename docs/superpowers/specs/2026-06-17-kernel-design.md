# Kernel — Design Spec (Sub-project #1)

> Status: **Draft (brainstorm output, 2026-06-17), approved-but-not-frozen.**
> The kernel is the foundation: an MCP web service that runs an embedded agent over a
> git-backed workspace. See `2026-06-17-context-vault-architecture.md` for the wider system.

## 1. Purpose & scope

The kernel proves the core magic: **external call → agent → result over your context.**

In scope: the agent engine + **door A** (the MCP `query` tool over HTTP).
Out of scope (later sub-projects, same engine reused): autonomous reorganization and the
dashboard chat (door B), the secret broker, the connection installer, multi-tenancy.

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Distribution | OSS self-host, single-tenant; must not preclude a future hosted layer |
| Engine | Claude Agent SDK, embedded **in-process** (TypeScript) |
| Model | Model-connector config + base-URL seam (local + cloud, any choice) |
| Transport | **HTTP-first** web service (MCP over HTTP/SSE) + optional local stdio |
| Response model | **Synchronous + live progress** (MCP progress notifications) |
| Permissions (door A) | **Full agent** (read/write/bash/tools), git-protected; config knob to tighten |
| Concurrency | Single-flight (one run at a time) |
| Versioning | Git-backed workspace; commit on success, reset on failure |
| Language | TypeScript / Node |

## 3. Architecture & data flow

```
  EXTERNAL CLIENTS                      THE KERNEL (web service)
  Claude Code ─┐
  Cursor ──────┼── HTTP/SSE + token ──▶ MCP server (HTTP-first)
  ChatGPT ─────┘                        • auth (bearer token)
       ▲                                • tool: query(instruction[, workspace])
       │ final result + progress        • streams progress ◀──────┐
       └──────────────────────────────────────┬──────────────────┼──
                                               ▼ instruction      │ progress + result
                                       Agent engine (Claude Agent SDK)
                                       • model via model-connector / base-URL seam
                                       • tools: read, write, bash, tool-calls (full agent)
                                               │ reads / writes
                                               ▼
                                       Workspace (git-backed)
                                       • your context: files / scripts / …
                                       • each run = 1 commit
                                       • event log (append-only)
```

Flow of one `query`:
1. Client calls `query("do X")` over HTTP with a bearer token.
2. The MCP server checks the token, takes the instruction, and enqueues a run
   (**single-flight** — one active run; extras wait in a short FIFO; full queue → "busy").
3. The engine starts a **fresh run** in the (workspace-scoped) directory, with the model
   from the connector. It reads the dir as its memory; may traverse, run bash/scripts, call
   tools, and write.
4. It streams **progress** back to the client during the run.
5. On finish: commit changes to git, append a line to the event log, return the **final
   result** (text + metadata: files touched, commit hash, run-id) over the open connection.

## 4. The `query` tool contract

- **In:** `instruction` (natural language, required). `workspace` (optional string) — the
  first-class seam for multi-workspace; defaults to the single/soft workspace for now.
- **Out:** final result as text + metadata (files touched, commit hash, run-id).
- **During:** progress updates via MCP progress notifications.

The kernel ships only `query`. No separate tool-discovery tool yet (the agent reasons over
what it has); `list_capabilities` arrives in sub-project #2.

## 5. Components

| # | Component | Responsibility |
|---|---|---|
| 1 | MCP server (HTTP) | Exposes `query` over HTTP/SSE, checks bearer token, plumbs progress. (+ optional stdio adapter.) |
| 2 | Run manager | Single-flight queue: serializes runs, assigns `run-id`, manages lifecycle, enforces max-runtime. |
| 3 | Engine adapter | Wraps the Claude Agent SDK: starts a session in the workspace, sets system prompt + permissions + which MCP servers the agent itself may use, streams progress. |
| 4 | Model connector | Resolves model config (base-URL/auth/model-id/flags); presets for Anthropic / Bedrock / Vertex / Ollama / LiteLLM. The local+cloud guarantee layer. |
| 5 | Workspace + git | The context dir; `git init`; commit per run; reset on failure; recoverability. |
| 6 | Event log | Append-only line per run: run-id, time, instruction, result summary, commit hash, status. |
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

Synchronous with live progress: the connection stays open, the engine streams progress
notifications during the run, and the final result returns at the end. A configurable
**max-runtime** caps truly long runs.

## 10. Permissions (door A)

Full agent: read, write, bash, tool-calls — all git-tracked and therefore recoverable.
Trust model: it is your endpoint behind a token (single-user self-host). A config knob
exists to tighten later (toward the architecture's scoped/configurable profiles).

## 11. Concurrency & git

- **Single-flight:** one active run; extras wait in a short FIFO; a full queue returns a
  structured "busy" error.
- **Git as safety net:** workspace is clean before a run. On **success** → `git commit`
  with run-id + summary. On **failure/crash** → `git reset --hard` to the last good commit,
  so the workspace is never left half-mutated. Git history = a sequence of recoverable,
  successful states.

## 12. Event log (kernel-minimal)

Append-only file; one line per run (run-id, timestamp, instruction, result summary, commit
hash, status). The rich event-feed UI is the dashboard (#4); this is the debuggable trail.

## 13. Config

Env + config file: model connector (provider/base-URL/auth/model-id/flags), workspace path,
auth token, permission profile, HTTP port, max-runtime, queue depth.

## 14. Error handling

| Case | Behavior |
|---|---|
| Auth failure | 401, clear message |
| Kernel busy / queue full | structured "busy" error |
| Model unreachable (e.g. Ollama/base-URL down) | clear error + hint, logged |
| Agent run crash | workspace reset to last commit, failure event logged, error + progress trail returned |
| Run timeout | abort, reset, log, return timeout error (covers the sync-timeout risk) |
| Long runs | progress notifications keep the connection alive |

## 15. Testing strategy

Layered, because agent output is non-deterministic:
- **Unit tests** on the deterministic scaffolding: tool registration, auth check,
  request/response framing, progress plumbing, run-manager queue/single-flight, git
  commit/reset, config + connector resolution. The engine is mocked.
- **Integration test** with a real-but-cheap model against a **fixture workspace**: assert
  invariants (a commit was created, the log grew, result is non-empty, no exceptions) — not
  exact agent output.
- **Dogfood** as the real validation: call it from Claude Code against your own context.

## 16. May feed back into this spec

- The `workspace` parameter and workspace-scoping detail (from multi-workspace #6).
- The system prompt content = the constitution's immutable core (from context tools #2).
- The permission profile shape (from the secret broker #3, scoped/hard isolation).

# MCP Activity Status (+ run/env papercut) — Design

**Status:** approved (design dialogue, 2026-07-02)
**Date:** 2026-07-02
**Backlog:** #2 (real connection signal) + #3 (run/env papercut)
**Related memory:** `connect-page-per-client-and-backlog`

## Problem

After connecting an MCP client to the kernel, a user has **no in-dashboard signal
that it worked**. The old decorative "live" chip was removed (polish D4), and MCP
`query`/`remember` runs auto-commit to the vault git + `log.md` but never surface in
the dashboard chat (that timeline is tied to the `/api/query` path, not the MCP
server). So the dashboard can't tell you whether your client actually reached the
kernel.

Separately (#3): the documented run command doesn't load `.env`, and a missing
`GEODE_WORKSPACE` directory surfaces as a misleading `spawn git ENOENT` instead of a
clear message.

## Key constraint

The MCP transport is **stateless Streamable HTTP** (`sessionIdGenerator: undefined`)
— every request is independent, there is no persistent "connection." So "is a client
connected?" is not a real thing to report. **"Last MCP activity"** is — and it
directly answers the user's question ("did it work?").

## Scope

**In scope:**
- **#2 — real MCP-activity status.** Record the last authenticated `/mcp` request
  (time, tool, running count) in memory; expose it over a session-guarded dashboard
  endpoint; show it in the top bar where the fake chip used to be.
- **#3 — run/env papercut.** Make the documented run command load `.env` when present,
  and replace the `spawn git ENOENT` for a missing workspace dir with a clear error.

**Explicitly out of scope (deferred):**
- **(c)** Rendering MCP runs as entries in the dashboard chat/timeline — richer, its
  own spec; the event log already holds the data (`runId`, `instruction`, `commit`).
- **(a)** A "test connection" button — weak for localhost: the dashboard is the
  kernel's own server, so such a test always succeeds and says nothing about whether
  *the user's client* connected. The last-activity signal is the honest one.

## Design

### Activity recorder (backend, in-memory)

A tiny shared object, created in `index.ts`, written by the `/mcp` route and read by
the dashboard. In-memory only — it reports activity **since this kernel started**
(resets on restart), which is the correct scope for "is my client reaching this
running kernel."

```ts
// src/mcpActivity.ts (new)
export interface McpActivitySnapshot { lastAt: string | null; lastTool: string | null; count: number; }
export interface McpActivity {
  record(tool: string | null): void;   // bump count, set lastAt = now, lastTool = tool ?? lastTool
  snapshot(): McpActivitySnapshot;
}
export function createMcpActivity(now?: () => string): McpActivity;
```

`record` is called once per authenticated `/mcp` POST. The tool name is a best-effort
read of the JSON-RPC body: `method === "tools/call"` → `params.name`; otherwise the
method (`"initialize"`, `"tools/list"`, …). Malformed/batch bodies → `record(null)`.

### Wiring

- `src/server.ts` `buildHttpApp(...)` gains an `activity: McpActivity` parameter. In the
  `/mcp` handler, **after auth passes**, call `activity.record(toolFromBody(req.body))`
  before handling. (Only authenticated requests count — unauth 401s don't.)
- `src/index.ts` creates the activity via `createMcpActivity()`, passes it to
  `buildHttpApp` and into `mountDashboard`'s deps.
- `src/dashboard/api.ts` gains a session-guarded `GET /api/mcp-status` →
  `McpActivitySnapshot` (sits alongside `GET /api/connect`). `ApiDeps` gains
  `activity: McpActivity`.

### Web

- `web/src/api.ts`: `McpStatus` type (`= McpActivitySnapshot`) + `mcpStatus()`.
- New `web/src/components/McpStatus.tsx`: a self-contained widget that polls
  `api.mcpStatus()` every ~10s. **Defensive** — optional-chains the call and renders
  `null` on missing/failed fetch (so it never throws in a partially-mocked test, the
  bug that bit VaultHome). Renders in the top bar's `.tb-right`, before the Connect
  pill.
  - `lastAt === null` → chip: **"MCP · no calls yet"** (muted).
  - else → chip: **"MCP · {relative(lastAt)} · {lastTool}"** e.g. "MCP · 2m ago · query" (emerald/live styling).
- `web/src/components/TopBar.tsx`: render `<McpStatus />` in `.tb-right`.
- A small `relativeTime(iso)` helper (e.g. "just now" / "2m ago" / "3h ago"); its own
  tiny tested unit.

### #3 — run/env papercut

- `package.json` `start`: load `.env` when present via Node's
  `--env-file-if-exists=.env` (Node ≥ 20.12; repo targets Node 25). Verify `tsx`
  passes the flag through at implementation; if not, add a `dev` script
  (`tsx --env-file=.env src/index.ts`) and document it as the local run command.
- `src/index.ts` `main()`: before `workspace.init()`, if
  `!existsSync(config.workspaceRoot)` throw
  `GEODE_WORKSPACE directory does not exist: <path> — create it or point GEODE_WORKSPACE at an existing dir.`

## Components touched

| File | Change |
|------|--------|
| `src/mcpActivity.ts` (new) | `McpActivity` recorder + `createMcpActivity` + `toolFromBody` helper. |
| `src/server.ts` | `buildHttpApp` takes `activity`; `/mcp` handler records after auth. |
| `src/index.ts` | Create activity; pass to `buildHttpApp` + `mountDashboard`; add missing-workspace guard. |
| `src/dashboard/api.ts` | `ApiDeps.activity`; `GET /api/mcp-status`. |
| `web/src/api.ts` | `McpStatus` type + `mcpStatus()`. |
| `web/src/components/McpStatus.tsx` (new) | Polling status widget (defensive). |
| `web/src/components/TopBar.tsx` | Render `<McpStatus />` in `.tb-right`. |
| `web/src/time.ts` (new) | `relativeTime(iso)` helper. |
| `web/src/app.css` | Status-chip styling (reuse `.chip`/emerald language). |
| `package.json` | `start` loads `.env` if present (or add `dev`). |

## Testing

- `test/mcpActivity.test.ts`: `record("query")` sets `lastTool:"query"`, `count:1`, non-null `lastAt`; a second `record(null)` keeps `lastTool:"query"` and `count:2`; `toolFromBody` maps a `tools/call` body → the tool name, other methods → the method, malformed → null.
- `src/server.ts` (extend the http test): an **authenticated** `/mcp` POST bumps the activity; an **unauthenticated** (401) one does not.
- `test/dashboard/api.test.ts` (extend): `GET /api/mcp-status` requires a session and returns the snapshot shape.
- `web/src/components/McpStatus.test.tsx`: `lastAt:null` → "no calls yet"; a populated snapshot → "…ago" + tool; a rejected/undefined `api.mcpStatus` → renders nothing (no throw).
- `web/src/time.test.ts`: `relativeTime` boundaries (just now / minutes / hours).
- `src/index.ts` guard: a startup check that a non-existent `GEODE_WORKSPACE` throws the clear message (unit-test the guard function, not `main()`).

## Live validation

Rebuild the SPA, restart the kernel, open `/`:
- Top bar shows **"MCP · no calls yet"** initially.
- Fire a real MCP call (`curl` an authenticated `tools/list` to `/mcp`, or a `query`);
  within the poll interval the chip flips to **"MCP · just now · …"**.
- Point `GEODE_WORKSPACE` at a non-existent dir → startup fails with the clear message
  (not `spawn git ENOENT`).

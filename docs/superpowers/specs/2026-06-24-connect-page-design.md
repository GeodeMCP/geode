# Connect Page (Sub-project A) — Design

**Status:** approved via mockup iteration (`docs/design/mockups/connect-page.html`)
**Date:** 2026-06-24
**Decision record:** memory `connect-tunnel-oauth-roadmap`

## Problem

A user who opens the dashboard has no in-app way to learn **how to connect an MCP client** to their kernel, **which tools** the MCP exposes (and what they do), or **how Claude's "paste-a-URL" custom-connector flow** will work. Today connecting means reading the README and hand-writing a config.

This is **sub-project A** of the Connect roadmap (A → C → B; see memory `connect-tunnel-oauth-roadmap`): the read-only surface. The tunnel (C) and the real remote-OAuth connector (B) are separate, later specs. Method 2 on this page therefore ships as a clearly-labelled **preview** state.

## Scope (A only)

In scope:
- A new **Connect** top-level view, always visible in the nav (next to Vault/Capabilities).
- A two-column, full-height layout: **left = action**, **right = explanation**.
- **Left:** two *alternative* connect methods (not steps) separated by an "or" divider:
  1. **Add with a config (JSON)** — copyable `mcp.json` + a Claude Code CLI one-liner, with the kernel's bearer token masked behind a reveal/copy control. Labelled "Works now". For local clients (Claude Code, Claude Desktop).
  2. **Add with a URL** — the claude.ai custom-connector flow, in a "Setup required" **preview** state: a dashed placeholder public URL, the 3 sign-in steps, and a disabled "Set up a public tunnel →" CTA (wires to C later).
- **Right:** an explanation rail — short MCP intro, the list of tools the client can call (name + human description + params), and a trust note about server-side secret injection.

Explicitly **out of scope** (deferred): the tunnel itself (C), the OAuth metadata/endpoints (B), making method 2 functional, multi-client config variants beyond Claude Code/Desktop, editing the token.

## Decisions (locked through mockup review)

1. **Nav placement:** `Connect` is added to `VIEWS` between `Capabilities` and `Integrations`, and to the `ALWAYS`-visible set (it doesn't depend on `hasTools`).
2. **Tools come from a backend catalog (single source of truth).** A shared `src/toolCatalog.ts` holds each tool's `name`, `description`, and display `params`. `server.ts` uses the catalog's `description` when registering each MCP tool (so the page copy and the MCP description are the *same string*, not two that can drift). The Connect page fetches the catalog via the API.
3. **Bearer token: masked with reveal + copy.** The token is returned over the already-authenticated dashboard API and rendered masked; a "reveal" control shows it and a "copy" control copies the full config. Rationale: the dashboard already gates and displays the vault; masking is hygiene, not a security boundary.
4. **Layout:** full-screen two columns; right rail `flex:0 0 36%` (min-width 380px), left `flex:1`. Title/lede live atop the left (action) column.
5. **Copy:** all UI strings English (per memory `english-only-app-strings`).

## API contract

One new session-guarded endpoint (sits after `requireSession` in the dashboard router):

```
GET /api/connect → {
  mcpUrl: string;        // `${baseUrl}/mcp`
  authToken: string;     // the kernel bearer (GEODE_AUTH_TOKEN)
  tools: ToolDoc[];      // the TOOL_CATALOG
}
```

```ts
interface ToolDoc {
  name: string;
  description: string;
  params: { name: string; type: string; required: boolean }[];
}
```

No SSE, no new auth, no writes. `ApiDeps` gains `authToken: string` (passed from `config.authToken` in `index.ts`).

## Components touched

| File | Change |
|------|--------|
| `src/toolCatalog.ts` (new) | `ToolDoc` type + `TOOL_CATALOG` for query/remember/list_capabilities/invoke (descriptions reused from current `server.ts` wording). |
| `src/server.ts` | Import `TOOL_CATALOG`; register each tool with the catalog's `description` (keep the inline zod `inputSchema`). |
| `src/dashboard/api.ts` | Add `authToken` to `ApiDeps`; add `GET /api/connect`. |
| `src/index.ts` | Pass `authToken: config.authToken` into `mountDashboard` deps. |
| `web/src/api.ts` | `ConnectInfo`/`ToolDoc` types + `connect()`. |
| `web/src/components/TopBar.tsx` | Add `Connect` to `VIEWS` + `ALWAYS`. |
| `web/src/App.tsx` | Import + route `Connect`. |
| `web/src/views/Connect.tsx` (new) | The two-column page. |
| `web/src/app.css` | Connect-page styles, scoped under `.connect` to avoid collisions. |
| `test/dashboard.e2e.manual.md` | Add a Connect smoke step. |

## Testing

- `test/toolCatalog.test.ts`: catalog has exactly `query, remember, list_capabilities, invoke`; every entry has a non-empty description.
- `src/server.ts` consistency: a test asserting the registered tool descriptions equal the catalog's (guards the single-source-of-truth wiring). Realised by checking `buildMcpServer` output or by asserting `server.ts` references `TOOL_CATALOG` (see plan).
- `test/dashboard/api.test.ts` (extend): `GET /api/connect` requires a session, and when logged in returns `mcpUrl` ending `/mcp`, the `authToken`, and 4 tools.
- `web/src/views/Connect.test.tsx`: with a mocked `api.connect()`, the 4 tool names render, the `mcpUrl` renders, the token is masked initially and reveals on click.
- Web: `TopBar` shows `Connect` regardless of `hasTools`.

## Live validation

Build the SPA, restart the demo kernel; open `/`, click **Connect**: see the two columns, copy the JSON (token masked → reveal works), see the 4 tools on the right, and method 2 in its disabled "Setup required" preview.

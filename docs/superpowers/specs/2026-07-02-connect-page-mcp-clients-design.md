# Connect Page — Per-Client MCP Connection Methods — Design

**Status:** approved (design dialogue, 2026-07-02)
**Date:** 2026-07-02
**Supersedes the local-connect portion of:** `2026-06-24-connect-page-design.md`
**Related memory:** `connect-tunnel-oauth-roadmap`

## Problem

The Connect page's first method ("Add with a config (JSON)") tells the user that
"Claude Code, **Claude Desktop** and other local MCP clients reach this kernel
directly" and shows a single `{"type":"http", …}` config. That is **wrong for
several clients** and produces a dead-end:

- **Claude Desktop** cannot use a `type:http` entry — its `claude_desktop_config.json`
  is stdio-only, and its "Add custom connector" UI field is **HTTPS-only** (rejects
  `http://localhost` with *"URL must start with https"*). A localhost bearer server
  needs the `mcp-remote` stdio bridge. *(Hit live during first-run testing on
  2026-07-02.)*
- **VS Code** uses the config key `servers`, not `mcpServers`.
- **Zed** (and other stdio-only clients) also need the bridge.

So a user picks their client, copies the one snippet we show, and it silently fails.
The single-generic-snippet approach relocates the dead-end rather than removing it.

## Goal

A first-time localhost user, whatever MCP client they use, gets the **correct**
config for that client without hitting a wall — and a user on an unlisted client
still has enough to succeed.

## Decision: short per-client picker + generic fallback (hybrid)

Web research (2026-07-02, see below) shows the industry norm is **per-client tabbed
snippets** (≈11–12 of ~14 MCP-shipping products), *because the config formats
genuinely differ* (`servers` vs `mcpServers` vs `serverUrl` vs TOML; native-http vs
bridge). Pure-generic instructions are subtly wrong for most clients. But the good
version is a **short curated set (4–5 clients) plus an "Other" generic block**, not
a sprawling 10-tab widget.

Chosen: a client selector with **Claude Code · Cursor · VS Code · Claude Desktop ·
Other MCP client**. Each option renders the *correct* snippet for that client,
derived from the two underlying connection patterns. Default selection: **Claude
Code** (the friction-free, tested happy path).

### The two underlying patterns (every client maps to one)

- **Pattern A — HTTP-native config with a bearer header.** The client connects to a
  remote streamable-HTTP MCP server directly, with an `Authorization` header in its
  own config. → Claude Code, Cursor, VS Code (and most modern clients).
- **Pattern B — stdio bridge via `mcp-remote`.** The client only speaks stdio, so we
  wrap the URL with `npx mcp-remote`. → Claude Desktop, Zed, other stdio-only clients.

Pattern C (remote OAuth URL, needs public HTTPS) already exists on the page as "Add
with a URL" and is **kept unchanged** as the third method.

## Scope

**In scope (front-end only):**
- Rewrite the "local" area of `web/src/views/Connect.tsx` from one misleading method
  into a **client picker** that renders the correct per-client snippet(s).
- Keep the bearer token **pre-injected** into every snippet, **masked with a
  reveal/copy control** (our advantage: the dashboard already holds the token
  server-side, so the copied snippet is ready to paste — no manual token step).
- Keep the "Add with a URL" (remote OAuth) method as-is.
- Add a one-line **"check it worked"** hint per client.
- Styles for the picker, scoped under `.connect`.

**Explicitly out of scope (deferred, noted for follow-up):**
- **No backend change.** All snippets derive from the existing
  `GET /api/connect` response (`mcpUrl` + `authToken`).
- **One-click deeplink buttons** ("Add to Cursor" / "Install in VS Code"). Now
  expected polish, but a *live* bearer token inside a base64/URL deeplink leaks to
  clipboard/shell-history, and the web-wrapper links are documented as fragile
  (404s). Fast-follow, not v1.
- **"Test connection" / live status widget** and **token rotate/regenerate** — both
  need backend work; separate backlog items (connection-status is backlog #2).
- Windsurf / Cline / Zed as *named* presets — they fall into Pattern A or B and are
  covered by "Other"; add later without new structure if warranted.

## Per-client snippets (the contract that must be correct)

`<url>` = `mcpUrl` (`http://localhost:8787/mcp`); `<token>` = `authToken`. Snippets
are generated client-side from those two values.

**Claude Code** — Pattern A. Config `~/.claude.json` (user) or `.mcp.json` (project):
```json
{ "mcpServers": { "geode": { "type": "http", "url": "<url>",
  "headers": { "Authorization": "Bearer <token>" } } } }
```
Plus the tested one-liner (kept, labelled "shortcut for Claude Code"):
```
claude mcp add --transport http geode <url> --header "Authorization: Bearer <token>"
```
Check: `claude mcp list` → `geode … ✔ Connected`.

**Cursor** — Pattern A. Config `~/.cursor/mcp.json` (global) or `.cursor/mcp.json`:
```json
{ "mcpServers": { "geode": { "url": "<url>",
  "headers": { "Authorization": "Bearer <token>" } } } }
```
Check: restart Cursor; the server shows a green dot in Settings → MCP.

**VS Code** — Pattern A, **key is `servers`**. Config `.vscode/mcp.json` (project) or
the user `mcp.json` (Command Palette → "MCP: Open User Configuration"):
```json
{ "servers": { "geode": { "type": "http", "url": "<url>",
  "headers": { "Authorization": "Bearer <token>" } } } }
```
Check: reload window; the Agent panel lists the `geode` tools.

**Claude Desktop** — Pattern B (bridge). One line first: *the "Add custom connector"
field is HTTPS-only — don't use it for localhost.* Instead, Settings → Developer →
Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{ "mcpServers": { "geode": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "<url>", "--allow-http",
           "--header", "Authorization:${AUTH_HEADER}"],
  "env": { "AUTH_HEADER": "Bearer <token>" } } } }
```
Notes baked into copy: `--allow-http` is **required** for a localhost http target;
the token is passed via `env` (`Authorization:${AUTH_HEADER}`) to dodge the
Cursor/Windows "space in `--header` arg" bug. Restart Claude Desktop fully.
Check: after restart, ask Desktop to list its tools; `geode` appears.

**Other MCP client** — generic. Show the raw **URL** and **token** (copyable), then
both shapes above (Pattern A `type:http`+`headers`, and the Pattern B `mcp-remote`
bridge), with one honest line: *"Most clients use the HTTP form; field names differ
(VS Code uses `servers`). If your client only takes a `command` server, use the
bridge. Check your client's MCP docs for the config-file location."*

## Token handling

- Real token **pre-injected** into every snippet; **masked by default**, single
  `reveal token` toggle flips all snippets; per-snippet `Copy` copies the *real*
  (unmasked) config. (Reuse the existing `CopyButton` + `revealed` state; the current
  code only masked one snippet — masking now applies to whichever snippet is shown.)
- Keep the existing "this is your bearer token — anyone with it can use your vault"
  note. No token editing/rotation in this change.

## Components touched

| File | Change |
|------|--------|
| `web/src/views/Connect.tsx` | Replace the single "config" method with a client picker (segmented control) + per-client snippet renderer driven by a small `CLIENTS` data array (`id`, `label`, `configHint`, `snippets(url, token)`, `check`). Keep the "Add with a URL" method and the right-hand "What it does" rail unchanged. Extend masking to the active snippet(s). |
| `web/src/app.css` | Styles for the segmented picker + per-client block + config-path hint, scoped under `.connect`. Reuse existing `.code`/`.codebar`/`.method` visual language. |
| `web/src/views/Connect.test.tsx` | Extend/author: picker renders 5 options; default is Claude Code; selecting VS Code shows the `servers` key; selecting Claude Desktop shows `mcp-remote` + `--allow-http`; token masked initially, reveals on toggle; "Other" shows raw url+token. |

No backend, API, or type changes (`GET /api/connect` and `ConnectInfo` unchanged).

## Testing

- `web/src/views/Connect.test.tsx` (component, mocked `api.connect()`):
  - Renders the 5-option picker; Claude Code selected by default; its snippet contains
    `"type": "http"` and the `claude mcp add` line.
  - Switching to **VS Code** renders a snippet whose top-level key is `servers`.
  - Switching to **Claude Desktop** renders a snippet containing `mcp-remote`,
    `--allow-http`, and `Authorization:${AUTH_HEADER}` (not an inline `type:http`).
  - Token is masked initially; `reveal token` shows the real value; `Copy` uses the
    real config (assert the copied text contains the unmasked token).
  - **Other** shows the raw `mcpUrl` and both shapes.
- No server-side tests change (front-end-only).

## Live validation

Build the SPA (`web/`), restart the demo kernel, open `/` → **Connect**:
- Cycle the picker through all five clients; confirm each snippet matches the contract
  above (esp. VS Code `servers`, Claude Desktop `mcp-remote --allow-http`).
- Reveal/hide the token; copy Claude Code's config and confirm the clipboard holds the
  real token.
- Re-run the real end-to-end path once (Claude Code): `claude mcp add …` from the
  copied one-liner → `claude mcp list` shows `✔ Connected` → a `query` call returns a
  vault answer. (Same path verified working on 2026-07-02.)

## Research backing (2026-07-02)

- Per-client tailored snippets are the prevailing pattern (Sentry, Apify, GitHub,
  Neon, Notion, Linear, Stripe, Zapier, Supabase, PostHog); pure-generic is the
  minority and is wrong for clients whose config key differs.
- `mcp-remote` is the universal stdio bridge; a **localhost http** target requires
  `--allow-http`, and passing the bearer via `env` avoids the space-in-arg bug on
  Cursor/Claude Desktop (Windows).
- Claude Desktop's custom-connector historically could not set a plain bearer header
  (OAuth-only) and rejects non-HTTPS URLs → the bridge is the reliable localhost path.
  *(Medium confidence, fast-moving; the bridge works regardless, so we default to it.)*
- Deeplink buttons (`cursor://…/mcp/install?config=<base64>`,
  `vscode:mcp/install?<url-encoded>`) are expected polish but carry token-leak/fragility
  risk → deferred.

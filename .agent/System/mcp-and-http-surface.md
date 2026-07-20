# MCP & HTTP surface

Current state of every externally reachable entry point in the kernel. Derived from the code, not from the dated specs in `docs/superpowers/specs/` — where the two disagree, this file is right and the spec is history.

**Related docs:** [Architecture & runtime](architecture.md) · [Security model](security-model.md) · [Vault data model](vault-data-model.md)

## Mount order

`src/index.ts:87-89` mounts three routers, and the order is load-bearing:

1. `buildHttpApp` routes — `/artifacts/*`, `/mcp`
2. OAuth router — well-known metadata, `/register`, `/authorize`, `/token`
3. Dashboard — `/api`, `/auth`, static files, SPA fallback

The SPA fallback is a catch-all, so it must stay last. Its negative lookahead (`src/dashboard/index.ts:59-66`) excludes `api/`, `auth/`, `mcp$`, `artifacts/`.

## MCP tools

All four are registered in `buildMcpServer` (`src/server.ts:122-180`). Server identity is `geode-kernel` v0.1.0.

A **fresh `McpServer` is constructed per HTTP request** (`src/server.ts:214`) and the transport uses `sessionIdGenerator: undefined` — the MCP surface is stateless, with no session reuse between calls.

Tool descriptions are not inline. They come from `toolDescription(name)` reading `TOOL_CATALOG` (`src/toolCatalog.ts:10-51`), which is the single source of truth shared with the dashboard's `GET /api/connect`. Change a description there, not in `server.ts`.

| Tool | Params | Returns |
|---|---|---|
| `query` | `instruction`, `workspace?` | Agent answer + artifact URLs + outcome line; `structuredContent: { runId, commit, filesTouched, artifacts }` |
| `remember` | `content`, `source?`, `title?`, `workspace?` | Same envelope; delegates to `query` with `role: "librarian"` |
| `list_capabilities` | none | XML-fenced capability nodes grouped by domain |
| `invoke` | `tool`, `action`, `connection?`, `params?`, `workspace?` | `{ status, body }` as JSON text; `structuredContent: { status }` |

### Registration and error behaviour

`invoke` is **conditionally registered** — only when `opts.secrets` is provided (`src/server.ts:164-177`). Production always passes it (`src/index.ts:75`), but a `buildMcpServer(deps)` without opts exposes only three tools. Tests rely on this.

`query`, `remember` and `invoke` catch their own errors and return `{ isError: true }` with a `"<tool> failed: …"` text body rather than a JSON-RPC error. `list_capabilities` is the one handler with **no try/catch** (`src/server.ts:94-98`) — a throw there propagates into the MCP SDK.

### The unused `workspace` param

`workspace` appears in three input schemas (`src/server.ts:132,148,173`) and in `RememberArgs`/`InvokeArgs`, but **nothing reads it anywhere**. It is either a reserved multi-vault placeholder or dead schema; the code does not say which. Treat it as unimplemented until issue #6 (multi-workspace) decides.

### Progress streaming

If a caller supplies `_meta.progressToken`, each `ProgressEvent` is flattened by `eventText` (`src/engine.ts:147-154`) and pushed as `notifications/progress`. Only `text`, `tool` and `notice` events survive the flattening — `thinking`, `tool_result` and `todos` are dropped.

### Commit semantics differ by caller

The MCP path passes no `opts`, so `opts.commit !== false` selects the **auto-commit** branch (`src/query.ts:129`). The dashboard wires `{ commit: false }` (`src/index.ts:97`) and leaves the tree dirty for a human to commit. This is the single most important behavioural fork in the run path — see [Architecture & runtime](architecture.md).

## HTTP routes

### Core (`src/server.ts:183-227`)

Global `express.json({ limit: "8mb" })` at `src/server.ts:185`.

| Method | Path | Auth |
|---|---|---|
| GET | `/artifacts/*` | Bearer token **or** signed `?exp=&sig=` URL |
| POST | `/mcp` | Static Bearer **or** OAuth access token (`checkMcpAuth`, `src/server.ts:24-28`) |

`/artifacts` uses a timing-safe Bearer compare (`src/server.ts:17-21`). A failed signature returns 403; no auth at all returns 401 (`src/server.ts:196-198`). Express 5 already URI-decodes the captured segment, so re-decoding is deliberately avoided (`src/server.ts:189-190`) — do not "fix" this.

On `/mcp` auth failure the kernel sets `WWW-Authenticate: Bearer resource_metadata="…", scope="vault"` when OAuth is configured, which is what drives MCP clients into the OAuth flow.

### OAuth (`src/oauth/router.ts:24-101`, mounted at root)

| Method | Path | Auth |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource` | public |
| GET | `/.well-known/oauth-authorization-server` | public |
| POST | `/register` | public — dynamic client registration, `token_endpoint_auth_method: "none"` |
| GET | `/authorize` | none; consent form requires login |
| POST | `/authorize` | session cookie or email+password; rate-limited 10/60s per IP |
| POST | `/token` | public, PKCE S256 |

`/authorize` requires `response_type=code`, `code_challenge_method=S256`, a registered `client_id`, an **exact-match** `redirect_uri`, and `resource === oauth.resource` (`src/oauth/router.ts:39-46`). Grants: `authorization_code` and `refresh_token` only.

### Dashboard `/api` (`src/dashboard/api.ts:58-238`)

Unauthenticated, before the session gate: `GET /api/auth-info`, `POST /api/setup` (409 if an owner exists), `POST /api/login`, `POST /api/logout`. Setup and login are rate-limited 8/60s.

`router.use(requireSession(deps.sessionKey))` at `api.ts:88` — **everything below requires a signed session cookie**:

- **Runs** — `POST /api/query`, `POST /api/remember` (both SSE), `POST /api/cancel`
- **Vault files** — `GET /api/tree`, `GET /api/status`, `GET|POST|DELETE /api/file`, `GET /api/diff`
- **Git** — `POST /api/commit` (regenerates artifacts first, non-fatal), `POST /api/discard`
- **History** — `GET|DELETE /api/history`
- **Connect** — `GET /api/connect` (mcpUrl, authToken, `TOOL_CATALOG`)
- **Tools** — `GET /api/tools`, `GET /api/tools/:id`, `POST /api/tools/:id/{install,uninstall,test}`
- **Secrets** — `GET /api/secrets`, `POST /api/secrets/:ref/link` (10-min single-use), `DELETE /api/secrets/:ref`
- **Uploads** — `POST /api/uploads` (busboy, 25 MB/file, 1000 files), `GET|DELETE /api/attachments`
- **Artifacts** — `GET /api/artifacts`, `GET /api/artifacts/download`, `POST /api/artifacts/public-link`
- **Gaps** — `GET /api/gaps`

`:id` and `:ref` are validated against `/^[A-Za-z0-9_-]+$/` (`api.ts:54`).

### Secret-capture links (`src/dashboard/index.ts:29-44`)

`GET|POST /auth/s/:token` authenticate by **HMAC link token only, no session** — this is how a secret is captured from someone who has no dashboard account. The token is consumed after a successful write.

## Two auth systems

Do not conflate them:

- **MCP / artifacts** — static `GEODE_AUTH_TOKEN` Bearer, or an OAuth access token. Machine callers.
- **Dashboard** — owner account, signed session cookie, 24h TTL. Humans.
- **Secret links** — single-use HMAC, no account. Third parties.

## Hardcoded limits

| Limit | Value | Where |
|---|---|---|
| JSON body | 8 MB | `src/server.ts:185` |
| Upload | 25 MB/file, 1000 files | `api.ts:91` |
| Session TTL | 24 h | `api.ts:55`, `oauth/router.ts:10` |
| Login rate limit | 8 / 60 s | `api.ts:60` |
| OAuth authorize rate limit | 10 / 60 s | `src/index.ts:89` |
| Secret link TTL | 600 s | `api.ts:216` |
| Artifact public URL TTL | 1 h default | `src/artifacts.ts:33` |
| `tool_result` text cap | 4000 chars | `src/engine.ts:70` |

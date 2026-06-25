# Remote OAuth Connector (Sub-project B) — Design

**Status:** approved in conversation; revised 2026-06-25 for the account-only auth model (owner account = identity). Pending plan.
**Decision record:** memory `connect-tunnel-oauth-roadmap` (pivot 2026-06-25), `parked-oauth-installer-decisions`. Builds on the **owner account** sub-project (`2026-06-25-owner-account-firstrun-design.md`).

## Problem

Claude's cloud surfaces (claude.ai, mobile, Cowork) connect to a remote MCP server with a **"paste a URL → sign in"** custom-connector flow that is **OAuth 2.1 only** — there is no field to paste a static bearer. Today the Geode kernel authenticates `/mcp` with one static bearer (`GEODE_AUTH_TOKEN`), so it cannot be added as a Claude custom connector. This sub-project makes the kernel a spec-compliant OAuth MCP server so a user with a **public HTTPS URL** can connect their vault to Claude and authenticate as the owner.

## Context: one mechanism, two paths (the pivot)

Per memory `connect-tunnel-oauth-roadmap`, the public base URL (`GEODE_BASE_URL`) is the only variable:
- **Path 1 — BYO public (this sub-project's target):** the self-hoster brings their own public HTTPS (reverse proxy + Let's Encrypt, their own cloudflared/tailscale/VPS), sets `GEODE_BASE_URL=https://vault.example.com`, and connects via claude.ai. Fully open, no GeodeMCP dependency.
- **Path 2 — managed tunnel (premium SaaS, deferred):** identical kernel code; GeodeMCP supplies the public URL. **Not built here** — the Connect page only shows a teaser CTA for localhost users.

The kernel acts as **both the OAuth 2.1 resource server and its own authorization server** — the spec explicitly allows the AS to be co-hosted with the resource server, and the AS's user-authentication/consent UX is left to the implementer. For a single-user vault the **owner account (the `geode_session`'s `sub`) is the identity** — built on the owner-account sub-project.

## Standards (from the MCP authorization spec + Anthropic connector docs)

- Resource server **MUST** implement RFC 9728 Protected Resource Metadata, return **401 + `WWW-Authenticate: Bearer resource_metadata=…, scope=…`** when unauthorized, and validate that tokens are **audience-bound** to this server (RFC 8707).
- Authorization server **MUST** be OAuth 2.1 with **PKCE S256 mandatory**, expose RFC 8414 Authorization Server Metadata, and **SHOULD** include `iss` in the authorize response (RFC 9207).
- **Dynamic Client Registration** (RFC 7591) supported → zero-config: the user pastes only the URL; Claude self-registers.
- Claude's redirect URI (hosted surfaces): `https://claude.ai/api/mcp/auth_callback`. Claude Code uses a loopback redirect. Transport: Streamable HTTP (already used).

## Endpoints (all derive from `GEODE_BASE_URL`)

Public (no auth), served on the base Express app (not under `/api`):

1. `GET /.well-known/oauth-protected-resource` → `{ resource: "<base>/mcp", authorization_servers: ["<base>"], scopes_supported: ["vault"], bearer_methods_supported: ["header"] }`
2. `GET /.well-known/oauth-authorization-server` → `{ issuer: "<base>", authorization_endpoint: "<base>/authorize", token_endpoint: "<base>/token", registration_endpoint: "<base>/register", scopes_supported: ["vault"], response_types_supported: ["code"], grant_types_supported: ["authorization_code","refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], authorization_response_iss_parameter_supported: true }`
3. `POST /register` (RFC 7591 DCR) → accepts `{ client_name, redirect_uris }`; returns a **stateless signed `client_id`** that encodes the registered `redirect_uris` (+ name). Public client (PKCE), so **no `client_secret`**. No storage needed.
4. `GET /authorize` → consent (see below); on approve, 302 to `redirect_uri?code=…&state=…&iss=<base>`.
5. `POST /token` → `authorization_code` (with `code_verifier`) and `refresh_token` grants; returns `{ access_token, token_type: "Bearer", expires_in, refresh_token, scope }`.

Changed:

6. `POST /mcp` → accept **either** the static `GEODE_AUTH_TOKEN` bearer (unchanged, for local/Path-1-CLI clients) **or** a valid OAuth access token (signature + audience `<base>/mcp` + not expired). Neither → **401 + `WWW-Authenticate`** pointing at endpoint 1.

A single scope, `vault`, covers all tools (query/remember/list_capabilities/invoke). Least-privilege multi-scope is deferred.

## Token & code design (stateless, HMAC-signed — reuses existing patterns)

No database. All artifacts are self-contained HMAC-signed blobs (same approach as `session.ts` / `secretLinks.ts`), signed with a dedicated key `loadOrCreateKey(join(secretsDir, "oauth"))`:

- **`client_id`**: `base64url(json{ redirect_uris, name, iat }) + "." + HMAC`. Verified at `/authorize` and `/token`; the requested `redirect_uri` MUST be in the signed set.
- **Authorization code**: signed blob encoding `{ client_id, redirect_uri, code_challenge, resource, scope, sub, nonce, exp(60s) }`, **single-use** (consumed-nonce `Set`, exactly like `secretLinks` does for `/auth/s`). Issued only after consent; `sub` = the authenticated owner principal id.
- **Access token**: signed blob `{ aud: "<base>/mcp", sub, scope, iat, exp(1h) }`. Verified on `/mcp`.
- **Refresh token**: signed blob `{ aud, sub, scope, iat, exp(30d) }`; `refresh_token` grant issues a fresh access token (same `sub`).

(The `sub` carries through code → tokens for the multi-user seam, mirroring the session `sub`.)

Revocation beyond auth-code single-use + expiry is **deferred** (documented). For a single-user self-host vault this is acceptable; rotating the `oauth` key invalidates all tokens as a break-glass.

## Consent at `/authorize` (owner account = identity)

(Revised 2026-06-25 for the account-only model — see `2026-06-25-owner-account-firstrun-design.md`.)

`GET /authorize` validates the request (client_id signature, `redirect_uri` ∈ signed set, `code_challenge_method=S256`, `resource` == `<base>/mcp`, `response_type=code`). Then it renders a **fully server-side** consent page (same visual shell as `authScreen.ts`) — no dependency on the React SPA:

- **Valid `geode_session` cookie present** → the page shows just consent: "**Allow Claude to access your Geode vault?**" with the requesting client name + the `vault` scope, and **Approve** / **Deny** buttons. The session's `sub` is the owner.
- **No valid session** → the page additionally shows **email + password** fields (the owner account) above Approve — authenticate-and-consent in one step. (If no owner exists yet, link to first-run setup instead of showing the fields.)
- **POST `/authorize`** (same-origin form): if credentials were supplied, verify via `AccountStore.verify(email, password)` and set a fresh `geode_session` for that principal; require a valid session either way; then on **Approve** mint the auth code carrying that principal's `sub` and 302 to `redirect_uri?code=…&state=…&iss=<base>`; on **Deny** 302 to `redirect_uri?error=access_denied&state=…&iss=<base>`. The original authorize params are carried through the form as signed hidden fields (tamper-proof).

This reuses `session.ts` (now carries `sub`) + `AccountStore.verify` (from the owner-account sub-project) + the `authScreen.ts` HTML shell, and is also **rate-limited** (reuse the login limiter). No external IdP, no SPA coupling. The OAuth router therefore needs `accounts: AccountStore` and `sessionKey` in its deps.

## Connect page: switch on base URL (+ managed-tunnel teaser)

`GET /api/connect` gains `publicBaseUrl: string | null` (null when the base URL is loopback — `localhost`/`127.0.0.1`). The **"Add with a URL"** card switches:
- **publicBaseUrl set** → show the real `"<base>/mcp"` URL (copyable) + the working claude.ai steps; the card is **live** (no longer a disabled preview).
- **localhost** → show the **"Use GeodeMCP's managed tunnel (premium)"** teaser CTA (replaces "Set up a public tunnel →"). Links out / marks "coming soon"; no functionality yet.

The JSON config (method 1) continues to use the effective base URL, so a BYO-public user's local config also shows their public URL.

## Components touched

| File | Change |
|------|--------|
| `src/oauth/tokens.ts` (new) | sign/verify helpers for client_id, auth code (single-use), access + refresh tokens (HMAC, audience/exp checks). Pure, unit-tested. |
| `src/oauth/metadata.ts` (new) | build the two `.well-known` documents from a base URL. Pure, unit-tested. |
| `src/oauth/router.ts` (new) | Express router: the two well-known GETs, `/register`, `/authorize` (GET consent + POST approve/deny), `/token`. Deps: token helpers + `session.ts` + `AccountStore` + a `sessionKey` + a rate limiter + the consent renderer. |
| `src/oauth/consentScreen.ts` (new) | server-rendered consent HTML (+ owner email/password fields when no session) reusing the `authScreen.ts` visual shell. |
| `src/server.ts` | `/mcp` auth accepts the static bearer **or** a valid OAuth access token; 401 now sets `WWW-Authenticate`. Mount the OAuth router in `buildHttpApp`. |
| `src/config.ts` | (maybe) `oauthEnabled` kill-switch (default on); `baseUrl` already exists. |
| `src/dashboard/api.ts` | `/api/connect` returns `publicBaseUrl`. |
| `web/src/views/Connect.tsx` + `web/src/api.ts` | method-2 card switches live-URL vs managed-tunnel teaser. |
| `src/index.ts` | wire the `oauth` signing key + mount. |

## Security considerations

- **Going public exposes the whole app** (dashboard login, `/auth/s` links, `/mcp`) to the internet behind the owner account / bearer. **Create the owner before exposing** (owner-account spec); use a strong owner password; the static `GEODE_AUTH_TOKEN` is now internet-reachable (treat as a strong secret). Prefer exposing only the connector routes (`/mcp`, `/.well-known/*`, `/register`, `/authorize`, `/token`) via a reverse proxy, keeping the dashboard private.
- **redirect_uri**: strict — only URIs in the signed `client_id` are accepted; no open redirect.
- **PKCE S256 mandatory**; auth code single-use + 60s TTL; tokens audience-bound to `<base>/mcp` (reject tokens minted for another resource); never accept tokens in the query string.
- **iss** included in authorize responses (RFC 9207) and advertised in AS metadata.
- **Consent gating**: tokens can only be minted after an interactive dashboard-authenticated Approve — a confused-deputy/CSRF-safe POST (same-origin, session-bound).
- Token theft window limited by 1h access-token expiry; break-glass = rotate the `oauth` key.

## Testing

- `test/oauth/tokens.test.ts`: client_id/code/access/refresh round-trip; tampered/expired/wrong-audience rejected; auth code single-use; PKCE S256 verification (good + bad verifier).
- `test/oauth/metadata.test.ts`: both documents have the required fields and derive endpoints from the base URL.
- `test/oauth/router.test.ts` (supertest-style, like `test/dashboard/*`): full happy path — `/register` → `/authorize` (401-redirect to login when no session; consent when session; Approve → code) → `/token` (code+verifier → access token) → `GET /mcp` with that token works; expired/forged token → 401 + `WWW-Authenticate`; deny → `error=access_denied`; mismatched redirect_uri/PKCE → 400.
- `test/server.test.ts` (extend): `/mcp` accepts the static bearer AND a valid OAuth token; unauthorized → 401 with `WWW-Authenticate` resource_metadata.
- `test/dashboard/api.test.ts` (extend): `/api/connect` returns `publicBaseUrl` (null for localhost, the URL when `GEODE_BASE_URL` is public).
- Web: Connect test asserts method-2 switches between live-URL and managed-teaser on `publicBaseUrl`.

## Live validation

Dev needs a public URL to test against claude.ai — use a **throwaway** tunnel (dev tool only): run a quick `cloudflared`/`ngrok` to the kernel, set `GEODE_BASE_URL` to the tunnel URL, then in claude.ai → Settings → Connectors → Add custom connector → paste `<tunnel>` → it discovers metadata, DCRs, opens `/authorize` → dashboard login + Approve → connected; verify the 4 tools appear and a `query` runs over OAuth. Then confirm a forged/expired token is rejected.

## Deferred (not this sub-project)

The managed tunnel service itself (Path 2 / SaaS); token revocation endpoint + a "connected clients" management UI; Client ID Metadata Documents (DCR suffices for Claude); multi-scope least-privilege; multi-user.

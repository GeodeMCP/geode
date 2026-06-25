# Owner Account & First-Run Setup — Design

**Status:** approved in conversation (2026-06-25); pending written-spec review
**Decision record:** memory `geode-business-model-licensing`, `connect-tunnel-oauth-roadmap`
**Sequencing:** ships **before** sub-project B (OAuth connector), which reuses the owner identity for consent.

## Problem

Today auth is configured only via environment variables: `GEODE_AUTH_TOKEN` (bearer) and an optional `GEODE_DASHBOARD_PASSWORD` compared in plaintext at `/api/login`. There is no account, no in-browser setup, no password hashing, no rate-limiting. That's thin for a public deployment and unfriendly as onboarding. We want a **simple single-owner account created in the browser on first run** (hashed credential), while keeping the auth layer **abstract enough to grow into multi-user/multi-tenant later** (the B2B-reseller play — see `geode-business-model-licensing`). The current env-password user must migrate seamlessly.

## Scope

In scope:
- A `Principal` identity + `AccountStore` seam (single owner now; interface ready for many).
- Sessions carry a **subject** (`sub` = principal id), not just "valid".
- First-run **"Create your vault"** screen (email + password) → hashed owner; then email+password login.
- **Env-password fallback** so headless/CI and the current deployment keep working; an authenticated upgrade path from env-mode to a real account.
- scrypt password hashing, login/setup **rate-limiting**, strong-password minimum.
- An owner CLI for reset/break-glass.

Explicitly **out of scope** (deferred): multiple accounts / roles / registration (multi-user — the paid team tier); **per-principal workspace routing** (that is #6 multi-workspace; we only ensure the `sub`-carrying seam doesn't block it); email **verification** and email-based password reset (no SMTP); SSO / "log in with Google"; the licensing implementation itself.

## Multi-user-ready seams (build now, single-owner)

1. **`Principal { id: string; email: string; createdAt: number }`** — the authenticated identity. `id` = a stable `randomUUID()` minted at creation.
2. **`AccountStore`** (interface): `hasOwner(): boolean`, `getOwner(): Principal | null`, `createOwner({ email, password }): Principal`, `verify(email, password): Principal | null`, `setPassword(email, password): void`. v1 implementation = machine-local JSON (`<accountDir>/account.json`, mode `0600`) holding one record `{ id, email, passwordHash, salt, createdAt }`. The interface makes a future multi-account/DB store a drop-in.
3. **Sessions carry `sub`.** `session.ts` token becomes `"<exp>.<sub>.<sig>"`, `sig = HMAC(key, "<exp>.<sub>")`. `verifySession` returns `{ sub } | null`; `requireSession` attaches the principal id to the request. (Format change invalidates existing cookies on upgrade — users simply re-login.)
4. **Workspace binding stays global for now**, but because sessions/OAuth tokens carry `sub`, routing a request to a per-principal workspace later is *additive* (that's #6). No `resolveWorkspace` indirection is built now (YAGNI); the seam is the `sub` already being present.

## Auth modes & first-run flow

The dashboard resolves one of three states via a public `GET /api/auth-info` → `{ mode: "setup" | "login", method: "account" | "password", authed: boolean }`:

- **`setup`** — no owner account exists **and** no `GEODE_DASHBOARD_PASSWORD` is set → SPA shows **"Create your vault"** (email + password + confirm). `POST /api/setup` validates a strong password, `createOwner`, signs a session for the new `sub`, returns `{ ok: true }`. Allowed only when `!hasOwner()` **and** (no env password **or** a valid session) — so on an env-protected (already public) kernel, an attacker cannot create the owner; the logged-in operator can.
- **`login` / `method: account`** — an owner exists → email + password, verified via `AccountStore.verify`.
- **`login` / `method: password`** — env fallback (`GEODE_DASHBOARD_PASSWORD` set, no owner yet) → password-only login as the implicit single owner principal (synthetic stable `sub`, e.g. `"env-owner"`). Same UX as today.

**Migration of the current user:** the running env-password deployment keeps working unchanged (password mode). When logged in via env, the dashboard offers **"Set up an account"** (email + password) → `POST /api/setup` (allowed: no owner + valid session) → creates the owner, which then takes precedence over the env password on the next login. No data migration; the vault itself is untouched.

## Security

- **scrypt** (Node's built-in `crypto.scryptSync`, per-record random salt) — no new dependency; constant-time hash comparison.
- **Rate-limiting** (`src/dashboard/rateLimit.ts`, small in-memory per-IP sliding-window + exponential backoff) on `POST /api/login` and `POST /api/setup` (and reused by `/authorize` in B). Returns `429` when tripped.
- **Strong password**: minimum length (≥ 10) enforced at setup/setPassword; trivially-weak rejected.
- Session cookie stays HMAC-signed, HttpOnly, SameSite=Lax, 24h, `Secure` when the base URL is https.
- The static `GEODE_AUTH_TOKEN` remains the `/mcp` bearer (unchanged here; dual-auth with OAuth lands in B).

## Components touched

| File | Change |
|------|--------|
| `src/account.ts` (new) | `Principal`, `AccountStore`, `createAccountStore(dir)` (scrypt, JSON `0600`). Pure-ish, unit-tested. |
| `src/dashboard/session.ts` | token carries `sub`; `signSession(key, ttl, sub)`, `verifySession → { sub } | null`, `requireSession` attaches the principal. |
| `src/dashboard/rateLimit.ts` (new) | in-memory per-IP limiter; `limit(key)` → `{ ok, retryAfter }`. Unit-tested. |
| `src/dashboard/api.ts` | `GET /api/auth-info`, `POST /api/setup`, reworked `POST /api/login` (account vs env), rate-limit wiring; `ApiDeps` gains `accounts: AccountStore`. |
| `src/config.ts` | `accountDir` (default `~/.geode`); `dashboardPassword` kept as fallback. |
| `src/index.ts` | construct `createAccountStore`, pass into the dashboard deps. |
| `src/ownerCli.ts` (new) | `npm run owner -- reset | set-password | show` (machine-local break-glass). |
| `web/src/views/Setup.tsx` (new) | the "Create your vault" screen. |
| `web/src/views/Login.tsx` | email+password (account) or password-only (env), driven by `auth-info`. |
| `web/src/App.tsx` | route setup vs login vs app from `auth-info`. |
| `web/src/api.ts` | `authInfo()`, `setup()`, updated `login()`. |
| `README.md` / docs | document first-run, env fallback, and the owner CLI. |

## Testing

- `test/account.test.ts`: create → verify round-trip; wrong password rejected; `hasOwner` transitions; persistence across instances; scrypt salt differs per record; weak password rejected.
- `test/dashboard/session.test.ts` (extend): token carries `sub`; `verifySession` returns it; tampered/expired/missing-`sub` rejected.
- `test/dashboard/rateLimit.test.ts`: trips after N attempts, recovers after the window.
- `test/dashboard/api.test.ts` (extend): `auth-info` returns the right mode/method in setup / account / env states; `/api/setup` happy path sets a session, `409` when an owner exists, `forbidden` when env-mode without a session; `/api/login` account-mode + password-mode; rate-limit → `429`; existing guarded routes still require a session.
- Web: `Setup.test.tsx` (renders, validates, submits), `Login.test.tsx` (switches account vs password mode from `auth-info`).

## Live validation

Fresh vault, no env password → open `/` → "Create your vault" → set email + password → land logged in. Restart → email+password login works; wrong password rate-limited after several tries. Then the env-fallback path: set `GEODE_DASHBOARD_PASSWORD`, no account file → password login as today; while logged in, "Set up an account" creates the owner and supersedes the env password. Confirm the current 8794 demo (env `pw`) still logs in unchanged.

## Deferred

Multiple accounts / roles / per-principal workspaces (#6 + team tier); email verification + reset-via-email; SSO; the AGPL+commercial licensing implementation + trademark/attribution work (tracked in `geode-business-model-licensing`).

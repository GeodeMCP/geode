# Owner Account & First-Run Setup — Design

**Status:** approved in conversation (2026-06-25); pending written-spec review
**Decision record:** memory `geode-business-model-licensing`, `connect-tunnel-oauth-roadmap`
**Sequencing:** ships **before** sub-project B (OAuth connector), which reuses the owner identity for consent.

## Problem

Today auth is configured only via the environment: `GEODE_AUTH_TOKEN` (the `/mcp` bearer). There is no dashboard account, no in-browser setup, no password hashing, no rate-limiting. That's thin for a public deployment and unfriendly as onboarding. We want a **simple single-owner account created in the browser on first run** (hashed credential), while keeping the auth layer **abstract enough to grow into multi-user/multi-tenant later** (the B2B-reseller play — see `geode-business-model-licensing`). Headless/fleet deployments must be able to provision the owner without a browser.

## Scope

In scope:
- A `Principal` identity + `AccountStore` seam (single owner now; interface ready for many).
- Sessions carry a **subject** (`sub` = principal id), not just "valid".
- First-run **"Create your vault"** screen (email + password) → hashed owner; then email+password login.
- **Env bootstrap** (`GEODE_OWNER_EMAIL`/`GEODE_OWNER_PASSWORD`) so headless/CI/fleet deployments can provision the owner without a browser.
- scrypt password hashing, login/setup **rate-limiting**, strong-password minimum.
- An owner CLI for reset/break-glass.

Explicitly **out of scope** (deferred): multiple accounts / roles / registration (multi-user — the paid team tier); **per-principal workspace routing** (that is #6 multi-workspace; we only ensure the `sub`-carrying seam doesn't block it); email **verification** and email-based password reset (no SMTP); SSO / "log in with Google"; the licensing implementation itself.

## Multi-user-ready seams (build now, single-owner)

1. **`Principal { id: string; email: string; createdAt: number }`** — the authenticated identity. `id` = a stable `randomUUID()` minted at creation.
2. **`AccountStore`** (interface): `hasOwner(): boolean`, `getOwner(): Principal | null`, `createOwner({ email, password }): Principal`, `verify(email, password): Principal | null`, `setPassword(email, password): void`. v1 implementation = machine-local JSON (`<accountDir>/account.json`, mode `0600`) holding one record `{ id, email, passwordHash, salt, createdAt }`. The interface makes a future multi-account/DB store a drop-in.
3. **Sessions carry `sub`.** `session.ts` token becomes `"<exp>.<sub>.<sig>"`, `sig = HMAC(key, "<exp>.<sub>")`. `verifySession` returns `{ sub } | null`; `requireSession` attaches the principal id to the request. (Format change invalidates existing cookies on upgrade — users simply re-login.)
4. **Workspace binding stays global for now**, but because sessions/OAuth tokens carry `sub`, routing a request to a per-principal workspace later is *additive* (that's #6). No `resolveWorkspace` indirection is built now (YAGNI); the seam is the `sub` already being present.

## Auth modes & first-run flow

(Revised 2026-06-25: simplified from an env-password fallback to account-only + env bootstrap.)

Auth is **account-only**. The dashboard resolves one of two states via a public `GET /api/auth-info` → `{ mode: "setup" | "login", authed: boolean }`:

- **`setup`** — no owner account exists → SPA shows **"Create your vault"** (email + password + confirm). `POST /api/setup` validates a strong password, `createOwner`, signs a session for the new `sub`, returns `{ ok: true }`. Allowed only when `!hasOwner()`.
- **`login`** — an owner exists → email + password, verified via `AccountStore.verify`.

**Env bootstrap (headless / fleet):** set `GEODE_OWNER_EMAIL` + `GEODE_OWNER_PASSWORD`. On first boot with no owner, the kernel creates a hashed account from them (then they're inert — once an owner exists, the variables are ignored). Alternatively `npm run owner -- create <email>` creates the owner from the CLI. Either way, login is then always email + password.

## Security

- **scrypt** (Node's built-in `crypto.scryptSync`, per-record random salt) — no new dependency; constant-time hash comparison.
- **Rate-limiting** (`src/dashboard/rateLimit.ts`, small in-memory per-IP fixed-window limiter) on `POST /api/login` and `POST /api/setup` (and reused by `/authorize` in B). Returns `429` when tripped.
- **Strong password**: minimum length (≥ 10) enforced at setup/setPassword; trivially-weak rejected.
- Session cookie stays HMAC-signed, HttpOnly, SameSite=Lax, 24h, `Secure` when the base URL is https.
- The static `GEODE_AUTH_TOKEN` remains the `/mcp` bearer (unchanged here; dual-auth with OAuth lands in B).
- **Create the owner before public exposure.** The dashboard always mounts, so a fresh, ownerless, publicly-exposed kernel can be claimed by the first visitor via the "Create your vault" screen. Always create the owner first — CLI (`npm run owner -- create <email>`) or env bootstrap (`GEODE_OWNER_EMAIL`/`GEODE_OWNER_PASSWORD`) — before exposing publicly, and prefer exposing only the connector routes through a reverse proxy.

## Components touched

| File | Change |
|------|--------|
| `src/account.ts` (new) | `Principal`, `AccountStore`, `createAccountStore(dir)` (scrypt, JSON `0600`). Pure-ish, unit-tested. |
| `src/dashboard/session.ts` | token carries `sub`; `signSession(key, ttl, sub)`, `verifySession → { sub } | null`, `requireSession` attaches the principal. |
| `src/dashboard/rateLimit.ts` (new) | in-memory per-IP limiter; `limit(key)` → `{ ok, retryAfter }`. Unit-tested. |
| `src/dashboard/api.ts` | `GET /api/auth-info`, `POST /api/setup`, reworked `POST /api/login` (account), rate-limit wiring; `ApiDeps` gains `accounts: AccountStore`. |
| `src/config.ts` | `accountDir` (default `~/.geode`); `ownerEmail`/`ownerPassword` env bootstrap. |
| `src/index.ts` | construct `createAccountStore`, env-bootstrap the owner on first boot, pass into the dashboard deps. |
| `src/ownerCli.ts` (new) | `npm run owner -- show | create <email> | set-password | reset` (machine-local break-glass). |
| `web/src/views/Setup.tsx` (new) | the "Create your vault" screen. |
| `web/src/views/Login.tsx` | email+password (account), driven by `auth-info`. |
| `web/src/App.tsx` | route setup vs login vs app from `auth-info`. |
| `web/src/api.ts` | `authInfo()`, `setup()`, updated `login()`. |
| `README.md` / docs | document first-run, env bootstrap, and the owner CLI. |

## Testing

- `test/account.test.ts`: create → verify round-trip; wrong password rejected; `hasOwner` transitions; persistence across instances; scrypt salt differs per record; weak password rejected.
- `test/dashboard/session.test.ts` (extend): token carries `sub`; `verifySession` returns it; tampered/expired/missing-`sub` rejected.
- `test/dashboard/rateLimit.test.ts`: trips after N attempts, recovers after the window.
- `test/dashboard/api.test.ts` (extend): `auth-info` returns the right mode in setup / login states; `/api/setup` happy path sets a session, `409` when an owner exists; `/api/login` account verification; rate-limit → `429`; existing guarded routes still require a session.
- Web: `Setup.test.tsx` (renders, validates, submits), `Login.test.tsx` (renders email+password, submits, driven by `auth-info`).

## Live validation

Fresh vault, no owner → open `/` → "Create your vault" → set email + password → land logged in. Restart → email+password login works; wrong password rate-limited after several tries. Then the env-bootstrap path: with no owner, set `GEODE_OWNER_EMAIL`/`GEODE_OWNER_PASSWORD` and boot → a hashed owner is created from them (then inert) → `/` shows the login screen → sign in with that email + password. Confirm `npm run owner -- show` prints the owner and `reset` returns to first-run.

## Deferred

Multiple accounts / roles / per-principal workspaces (#6 + team tier); email verification + reset-via-email; SSO; the AGPL+commercial licensing implementation + trademark/attribution work (tracked in `geode-business-model-licensing`).

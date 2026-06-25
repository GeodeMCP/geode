# Remote OAuth Connector (Sub-project B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Geode kernel a spec-compliant OAuth 2.1 MCP server so a user with a public HTTPS URL can add their vault to Claude via the "paste a URL → sign in" custom-connector flow, authenticating as the owner account.

**Architecture:** The kernel is both the OAuth resource server and its own authorization server. Stateless HMAC-signed tokens/codes (dedicated `oauth` key). DCR (zero-config), PKCE S256, consent via the owner account (`AccountStore` + `geode_session` `sub`). `/mcp` accepts the static bearer OR a valid OAuth access token. The Connect page switches method-2 live vs managed-tunnel teaser on the public base URL.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` suffix), Express 5, Node `crypto` (HMAC/scrypt), vitest; React + Vite.

**Reference:** spec `docs/superpowers/specs/2026-06-25-oauth-connector-design.md`. Builds on the owner-account sub-project (`src/account.ts`, `session.ts` carries `sub`, `src/dashboard/rateLimit.ts`).

---

### Task 1: OAuth tokens & codes (`src/oauth/tokens.ts`)

**Files:** Create `src/oauth/tokens.ts`; Test `test/oauth/tokens.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/oauth/tokens.test.ts`:
```ts
import { expect, test } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createOAuth } from "../../src/oauth/tokens.js";

const key = Buffer.from("k".repeat(32));
const mk = (now = () => 1_000_000) => createOAuth({ signKey: key, baseUrl: "https://v.example.com", now });

test("client_id round-trips redirect_uris; tampering is rejected", () => {
  const o = mk();
  const cid = o.registerClient({ redirect_uris: ["https://claude.ai/cb"], name: "Claude" });
  expect(o.verifyClientId(cid)).toEqual({ redirect_uris: ["https://claude.ai/cb"], name: "Claude" });
  expect(o.verifyClientId(cid + "x")).toBeNull();
  expect(o.verifyClientId("garbage")).toBeNull();
});

test("auth code is single-use and expires", () => {
  let t = 1_000_000; const o = mk(() => t);
  const code = o.mintCode({ client_id: "c", redirect_uri: "https://claude.ai/cb", code_challenge: "cc", resource: "https://v.example.com/mcp", scope: "vault", sub: "owner-1" });
  const p = o.consumeCode(code);
  expect(p?.sub).toBe("owner-1");
  expect(o.consumeCode(code)).toBeNull();              // single-use
  const code2 = o.mintCode({ client_id: "c", redirect_uri: "r", code_challenge: "cc", resource: "x", scope: "vault", sub: "s" });
  t += 61_000;
  expect(o.consumeCode(code2)).toBeNull();             // expired (60s TTL)
});

test("PKCE S256 verifies the matching verifier only", () => {
  const o = mk();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  expect(o.verifyPkce(verifier, challenge)).toBe(true);
  expect(o.verifyPkce("wrong", challenge)).toBe(false);
});

test("access/refresh tokens carry sub+scope, are audience-bound, and expire", () => {
  let t = 1_000_000; const o = mk(() => t);
  const at = o.mintAccessToken({ sub: "owner-1", scope: "vault" });
  expect(o.verifyAccessToken(at.token)).toEqual({ sub: "owner-1", scope: "vault" });
  // a token from a different-audience server must not verify here
  const other = createOAuth({ signKey: key, baseUrl: "https://evil.example.com", now: () => t }).mintAccessToken({ sub: "x", scope: "vault" });
  expect(o.verifyAccessToken(other.token)).toBeNull();
  const rt = o.mintRefreshToken({ sub: "owner-1", scope: "vault" });
  expect(o.verifyRefreshToken(rt)).toEqual({ sub: "owner-1", scope: "vault" });
  t += 3_600_001;
  expect(o.verifyAccessToken(at.token)).toBeNull();    // access expired (1h)
  expect(o.verifyRefreshToken(rt)).not.toBeNull();      // refresh still valid (30d)
});

test("auth-request blob round-trips and rejects tampering", () => {
  const o = mk();
  const areq = o.mintAuthRequest({ client_id: "c", redirect_uri: "https://claude.ai/cb", code_challenge: "cc", resource: "https://v.example.com/mcp", scope: "vault", state: "s1" });
  expect(o.verifyAuthRequest(areq)?.state).toBe("s1");
  expect(o.verifyAuthRequest(areq + "x")).toBeNull();
});
```

- [ ] **Step 2: Run — confirm fail.** `npx vitest run test/oauth/tokens.test.ts`

- [ ] **Step 3: Implement `src/oauth/tokens.ts`:**
```ts
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString("base64url");
const dec = (s: string): any => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export interface ClientReg { redirect_uris: string[]; name: string }
export interface CodePayload { client_id: string; redirect_uri: string; code_challenge: string; resource: string; scope: string; sub: string }
export interface AuthRequest { client_id: string; redirect_uri: string; code_challenge: string; resource: string; scope: string; state: string }
export interface TokenClaims { sub: string; scope: string }

export interface OAuth {
  readonly resource: string;
  registerClient(reg: ClientReg): string;
  verifyClientId(clientId: string): ClientReg | null;
  mintAuthRequest(p: AuthRequest): string;
  verifyAuthRequest(token: string): AuthRequest | null;
  mintCode(p: CodePayload): string;
  consumeCode(code: string): CodePayload | null;
  verifyPkce(codeVerifier: string, codeChallenge: string): boolean;
  mintAccessToken(c: TokenClaims): { token: string; expiresIn: number };
  verifyAccessToken(token: string): TokenClaims | null;
  mintRefreshToken(c: TokenClaims): string;
  verifyRefreshToken(token: string): TokenClaims | null;
}

const ACCESS_TTL = 3_600_000, REFRESH_TTL = 30 * 86_400_000, CODE_TTL = 60_000, AREQ_TTL = 600_000;

// Stateless HMAC-signed blobs: "<kind>.<base64url(json)>.<sig>". Single-use codes tracked in a nonce set.
export function createOAuth(opts: { signKey: Buffer; baseUrl: string; now?: () => number }): OAuth {
  const now = opts.now ?? (() => Date.now());
  const resource = `${opts.baseUrl}/mcp`;
  const consumed = new Set<string>();
  const sign = (payload: string) => createHmac("sha256", opts.signKey).update(payload).digest("base64url");
  const make = (kind: string, body: object): string => { const payload = `${kind}.${enc(body)}`; return `${payload}.${sign(payload)}`; };
  const open = (kind: string, token: string): any | null => {
    const j = token.lastIndexOf("."); if (j < 0) return null;
    const payload = token.slice(0, j), sig = token.slice(j + 1);
    if (!payload.startsWith(kind + ".")) return null;
    const a = Buffer.from(sig), b = Buffer.from(sign(payload));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try { return dec(payload.slice(kind.length + 1)); } catch { return null; }
  };
  const live = (body: any): any | null => (body && typeof body.exp === "number" && body.exp >= now() ? body : null);
  return {
    resource,
    registerClient: (reg) => make("cid", { redirect_uris: reg.redirect_uris, name: reg.name, iat: now() }),
    verifyClientId: (cid) => { const b = open("cid", cid); return b && Array.isArray(b.redirect_uris) ? { redirect_uris: b.redirect_uris.map(String), name: String(b.name ?? "") } : null; },
    mintAuthRequest: (p) => make("areq", { ...p, exp: now() + AREQ_TTL }),
    verifyAuthRequest: (t) => { const b = live(open("areq", t)); return b ? { client_id: b.client_id, redirect_uri: b.redirect_uri, code_challenge: b.code_challenge, resource: b.resource, scope: b.scope, state: b.state } : null; },
    mintCode: (p) => make("code", { ...p, nonce: randomBytes(9).toString("base64url"), exp: now() + CODE_TTL }),
    consumeCode: (code) => {
      const b = live(open("code", code));
      if (!b || consumed.has(b.nonce)) return null;
      consumed.add(b.nonce);
      return { client_id: b.client_id, redirect_uri: b.redirect_uri, code_challenge: b.code_challenge, resource: b.resource, scope: b.scope, sub: b.sub };
    },
    verifyPkce: (verifier, challenge) => { const h = createHash("sha256").update(verifier).digest("base64url"); const a = Buffer.from(h), b = Buffer.from(challenge); return a.length === b.length && timingSafeEqual(a, b); },
    mintAccessToken: (c) => ({ token: make("at", { aud: resource, sub: c.sub, scope: c.scope, exp: now() + ACCESS_TTL }), expiresIn: Math.floor(ACCESS_TTL / 1000) }),
    verifyAccessToken: (t) => { const b = live(open("at", t)); return b && b.aud === resource ? { sub: b.sub, scope: b.scope } : null; },
    mintRefreshToken: (c) => make("rt", { aud: resource, sub: c.sub, scope: c.scope, exp: now() + REFRESH_TTL }),
    verifyRefreshToken: (t) => { const b = live(open("rt", t)); return b && b.aud === resource ? { sub: b.sub, scope: b.scope } : null; },
  };
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** — `git add src/oauth/tokens.ts test/oauth/tokens.test.ts && git commit -m "feat(oauth): stateless HMAC tokens, codes, client_id, PKCE"`

---

### Task 2: Metadata documents (`src/oauth/metadata.ts`)

**Files:** Create `src/oauth/metadata.ts`; Test `test/oauth/metadata.test.ts`.

- [ ] **Step 1: Failing test** — `test/oauth/metadata.test.ts`:
```ts
import { expect, test } from "vitest";
import { protectedResourceMetadata, authorizationServerMetadata } from "../../src/oauth/metadata.js";

test("protected-resource metadata points at the AS and the /mcp resource", () => {
  const m = protectedResourceMetadata("https://v.example.com");
  expect(m.resource).toBe("https://v.example.com/mcp");
  expect(m.authorization_servers).toEqual(["https://v.example.com"]);
  expect(m.scopes_supported).toContain("vault");
});

test("authorization-server metadata exposes endpoints + S256 + iss", () => {
  const m = authorizationServerMetadata("https://v.example.com");
  expect(m.issuer).toBe("https://v.example.com");
  expect(m.authorization_endpoint).toBe("https://v.example.com/authorize");
  expect(m.token_endpoint).toBe("https://v.example.com/token");
  expect(m.registration_endpoint).toBe("https://v.example.com/register");
  expect(m.code_challenge_methods_supported).toEqual(["S256"]);
  expect(m.authorization_response_iss_parameter_supported).toBe(true);
});
```

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement `src/oauth/metadata.ts`:**
```ts
export function protectedResourceMetadata(baseUrl: string) {
  return { resource: `${baseUrl}/mcp`, authorization_servers: [baseUrl], scopes_supported: ["vault"], bearer_methods_supported: ["header"] };
}
export function authorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    scopes_supported: ["vault"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
  };
}
```
- [ ] **Step 4: PASS.** **Step 5: Commit** — `git add src/oauth/metadata.ts test/oauth/metadata.test.ts && git commit -m "feat(oauth): protected-resource + authorization-server metadata"`

---

### Task 3: Consent screen (`src/oauth/consentScreen.ts`)

**Files:** Create `src/oauth/consentScreen.ts`. (Covered by the router test in Task 4; no separate test.)

- [ ] **Step 1: Implement** — reuse the `authScreen.ts` visual shell. `renderConsent` builds a same-origin POST form carrying the signed `req` blob, Approve/Deny buttons, and (when `needsLogin`) owner email+password fields:
```ts
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const SHELL = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Geode — connect</title>
<style>
:root{--bg:#0b0f0e;--surface:#141917;--input:#080b0a;--text:#f2f2f2;--muted:#a3a3a3;--faint:#777;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.12);--green:#34d399;--emerald-300:#6ee7b7;--blue:#2563eb;--blue-500:#3b82f6;--blue-100:#dbeafe;}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.name{font-weight:600;font-size:19px;margin-bottom:14px}
.card{width:460px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.17em;font-weight:600;color:var(--green)}
h2{font-size:21px;margin:6px 0 4px}.scope{display:inline-block;font-family:monospace;font-size:12.5px;color:var(--emerald-300);border:1px solid var(--border-strong);border-radius:999px;padding:4px 11px;margin:8px 0}
label{font-size:12.5px;color:var(--muted);display:block;margin:10px 0 6px}
input{width:100%;background:var(--input);border:1px solid var(--border-strong);border-radius:9px;padding:12px 13px;color:var(--text);font-size:14px}
.row{display:flex;gap:10px;margin-top:16px}.btn{flex:1;font-weight:500;font-size:14.5px;border-radius:8px;padding:12px 16px;cursor:pointer;border:1px solid}
.approve{background:var(--blue);border-color:var(--blue-500);color:var(--blue-100)}.deny{background:transparent;border-color:var(--border-strong);color:var(--muted)}
.err{color:#eaa;font-size:13px;margin:6px 0}.note{color:var(--faint);font-size:12.5px;line-height:1.5;margin:12px 0 0}
</style></head><body><div class="name">Geode</div>${body}</body></html>`;

export function renderConsent(opts: { clientName: string; scope: string; action: string; req: string; needsLogin: boolean; error?: string }): string {
  const login = opts.needsLogin
    ? `<label>Email</label><input type="email" name="email" autocomplete="username" autofocus>
       <label>Password</label><input type="password" name="password" autocomplete="current-password">`
    : "";
  return SHELL(`<form class="card" method="post" action="${esc(opts.action)}">
    <span class="eyebrow">Connect</span>
    <h2>Allow ${esc(opts.clientName || "this client")} to access your vault?</h2>
    <span class="scope">scope: ${esc(opts.scope)}</span>
    <input type="hidden" name="req" value="${esc(opts.req)}">
    ${login}
    ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
    <div class="row">
      <button class="btn deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="btn approve" type="submit" name="decision" value="approve">Approve</button>
    </div>
    <p class="note">Approving lets this client read and write your vault and run integrations on your behalf, via the Model Context Protocol.</p>
  </form>`);
}
```
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`. **Step 3: Commit** — `git add src/oauth/consentScreen.ts && git commit -m "feat(oauth): server-rendered consent screen"`

---

### Task 4: OAuth router (`src/oauth/router.ts`)

**Files:** Create `src/oauth/router.ts`; Test `test/oauth/router.test.ts`.

- [ ] **Step 1: Failing test** — `test/oauth/router.test.ts` (boots an express app with the router, a real `createOAuth`, and a real empty-then-seeded `AccountStore`):
```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createOAuthRouter } from "../../src/oauth/router.js";
import { createOAuth } from "../../src/oauth/tokens.js";
import { createAccountStore } from "../../src/account.js";
import { createRateLimiter } from "../../src/dashboard/rateLimit.js";

let server: Server, url: string, root: string;
const KEY = Buffer.from("k".repeat(32));
const BASE = () => url;                              // base URL = the test server origin

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-oauth-"));
  const accounts = createAccountStore(join(root, ".accounts"));
  accounts.createOwner({ email: "owner@test.dev", password: "owner-password-1" });
  const app = express(); app.use(express.json());
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
  // base URL only known after listen → build the router now and mount it
  const oauth = createOAuth({ signKey: KEY, baseUrl: url });
  app.use(createOAuthRouter({ oauth, accounts, sessionKey: KEY, baseUrl: url, secure: false, rateLimit: createRateLimiter({ limit: 50, windowMs: 60_000 }) }));
}
beforeEach(boot);
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("metadata endpoints are public", async () => {
  expect((await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json()).resource).toBe(`${url}/mcp`);
  expect((await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json()).token_endpoint).toBe(`${url}/token`);
});

test("full DCR → authorize(login+approve) → token → access token", async () => {
  // 1. register
  const reg = await (await fetch(`${url}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [`${url}/cb`] }) })).json();
  expect(reg.client_id).toBeTruthy();
  // 2. PKCE
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authUrl = `${url}/authorize?response_type=code&client_id=${encodeURIComponent(reg.client_id)}&redirect_uri=${encodeURIComponent(url + "/cb")}&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(url + "/mcp")}&scope=vault&state=xyz`;
  const consent = await fetch(authUrl);
  expect(consent.status).toBe(200);
  const html = await consent.text();
  expect(html).toContain("Approve");
  const req = /name="req" value="([^"]+)"/.exec(html)![1].replace(/&amp;/g, "&");
  // 3. POST approve with owner credentials (no session yet)
  const form = new URLSearchParams({ req, email: "owner@test.dev", password: "owner-password-1", decision: "approve" });
  const approved = await fetch(`${url}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, redirect: "manual" });
  expect(approved.status).toBe(302);
  const loc = new URL(approved.headers.get("location")!);
  expect(loc.searchParams.get("state")).toBe("xyz");
  const code = loc.searchParams.get("code")!;
  expect(code).toBeTruthy();
  // 4. exchange code → token
  const tok = await (await fetch(`${url}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `${url}/cb` }) })).json();
  expect(tok.token_type).toBe("Bearer");
  expect(tok.access_token).toBeTruthy();
  expect(tok.refresh_token).toBeTruthy();
});

test("deny redirects with access_denied; bad PKCE → invalid_grant; bad credentials re-prompt", async () => {
  const reg = await (await fetch(`${url}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "C", redirect_uris: [`${url}/cb`] }) })).json();
  const challenge = createHash("sha256").update("v").digest("base64url");
  const authUrl = `${url}/authorize?response_type=code&client_id=${encodeURIComponent(reg.client_id)}&redirect_uri=${encodeURIComponent(url + "/cb")}&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(url + "/mcp")}&scope=vault&state=s`;
  const req = /name="req" value="([^"]+)"/.exec(await (await fetch(authUrl)).text())![1].replace(/&amp;/g, "&");
  // wrong password → 200 re-prompt (not a redirect)
  const wrong = await fetch(`${url}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ req, email: "owner@test.dev", password: "nope", decision: "approve" }), redirect: "manual" });
  expect(wrong.status).toBe(200);
  // deny → redirect error
  const deny = await fetch(`${url}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ req, email: "owner@test.dev", password: "owner-password-1", decision: "deny" }), redirect: "manual" });
  expect(new URL(deny.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  // approve then exchange with a WRONG verifier → invalid_grant
  const okForm = new URLSearchParams({ req, email: "owner@test.dev", password: "owner-password-1", decision: "approve" });
  const code = new URL((await fetch(`${url}/authorize`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: okForm, redirect: "manual" })).headers.get("location")!).searchParams.get("code")!;
  const bad = await fetch(`${url}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, code_verifier: "WRONG", redirect_uri: `${url}/cb` }) });
  expect(bad.status).toBe(400);
});

test("rejects an unregistered/tampered client_id and a redirect_uri not in the registration", async () => {
  const challenge = createHash("sha256").update("v").digest("base64url");
  const bad = await fetch(`${url}/authorize?response_type=code&client_id=forged&redirect_uri=${encodeURIComponent(url + "/cb")}&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(url + "/mcp")}&scope=vault`);
  expect(bad.status).toBe(400);
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement `src/oauth/router.ts`:**
```ts
import { Router, type Request, type Response } from "express";
import express from "express";
import type { OAuth } from "./tokens.js";
import type { AccountStore } from "../account.js";
import type { RateLimiter } from "../dashboard/rateLimit.js";
import { sessionFromCookie, signSession, setSessionCookie } from "../dashboard/session.js";
import { protectedResourceMetadata, authorizationServerMetadata } from "./metadata.js";
import { renderConsent } from "./consentScreen.js";

const SESSION_TTL = 86_400_000; // matches dashboard SESSION_TTL
const ipKey = (req: Request) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";

export interface OAuthRouterDeps {
  oauth: OAuth;
  accounts: AccountStore;
  sessionKey: Buffer;
  baseUrl: string;
  secure: boolean;
  rateLimit: RateLimiter;
}

export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false }));   // for the POST /authorize form (JSON parsed app-level)

  router.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(protectedResourceMetadata(deps.baseUrl)));
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(authorizationServerMetadata(deps.baseUrl)));

  router.post("/register", (req, res) => {
    const redirect_uris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
    if (!redirect_uris.length) { res.status(400).json({ error: "invalid_redirect_uri" }); return; }
    const client_name = String(req.body?.client_name ?? "MCP Client");
    const client_id = deps.oauth.registerClient({ redirect_uris, name: client_name });
    res.status(201).json({ client_id, client_name, redirect_uris, token_endpoint_auth_method: "none" });
  });

  const validateAuthQuery = (q: any) => {
    if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) return null;
    const client = deps.oauth.verifyClientId(String(q.client_id ?? ""));
    const redirect_uri = String(q.redirect_uri ?? "");
    if (!client || !client.redirect_uris.includes(redirect_uri)) return null;
    if (String(q.resource ?? "") !== deps.oauth.resource) return null;
    return { client, redirect_uri, scope: String(q.scope || "vault") || "vault", state: String(q.state ?? "") };
  };

  router.get("/authorize", (req, res) => {
    const v = validateAuthQuery(req.query);
    if (!v) { res.status(400).type("html").send("<p>Invalid authorization request.</p>"); return; }
    if (!deps.accounts.hasOwner()) { res.redirect("/"); return; }   // first-run setup instead
    const reqBlob = deps.oauth.mintAuthRequest({ client_id: String(req.query.client_id), redirect_uri: v.redirect_uri, code_challenge: String(req.query.code_challenge), resource: deps.oauth.resource, scope: v.scope, state: v.state });
    const needsLogin = !sessionFromCookie(deps.sessionKey, req.headers.cookie);
    res.type("html").send(renderConsent({ clientName: v.client.name, scope: v.scope, action: "/authorize", req: reqBlob, needsLogin }));
  });

  router.post("/authorize", (req, res) => {
    const rl = deps.rateLimit.check(ipKey(req)); if (!rl.ok) { res.status(429).type("html").send("<p>Too many attempts. Try again shortly.</p>"); return; }
    const areq = deps.oauth.verifyAuthRequest(String(req.body?.req ?? ""));
    if (!areq) { res.status(400).type("html").send("<p>This request expired. Start the connection again from Claude.</p>"); return; }
    const client = deps.oauth.verifyClientId(areq.client_id);
    if (!client || !client.redirect_uris.includes(areq.redirect_uri)) { res.status(400).type("html").send("<p>Invalid client.</p>"); return; }

    let session = sessionFromCookie(deps.sessionKey, req.headers.cookie);
    const email = String(req.body?.email ?? ""), password = String(req.body?.password ?? "");
    if (!session && email && password) {
      const p = deps.accounts.verify(email, password);
      if (p) { setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, p.id), deps.secure); session = { sub: p.id }; }
    }
    if (!session) {
      res.type("html").send(renderConsent({ clientName: client.name, scope: areq.scope, action: "/authorize", req: String(req.body?.req ?? ""), needsLogin: true, error: deps.accounts.hasOwner() ? "Invalid credentials" : "No owner — complete first-run setup" }));
      return;
    }
    const sep = areq.redirect_uri.includes("?") ? "&" : "?";
    const tail = `state=${encodeURIComponent(areq.state)}&iss=${encodeURIComponent(deps.baseUrl)}`;
    if (String(req.body?.decision) !== "approve") { res.redirect(`${areq.redirect_uri}${sep}error=access_denied&${tail}`); return; }
    const code = deps.oauth.mintCode({ client_id: areq.client_id, redirect_uri: areq.redirect_uri, code_challenge: areq.code_challenge, resource: areq.resource, scope: areq.scope, sub: session.sub });
    res.redirect(`${areq.redirect_uri}${sep}code=${encodeURIComponent(code)}&${tail}`);
  });

  router.post("/token", (req: Request, res: Response) => {
    const grant = String(req.body?.grant_type ?? "");
    if (grant === "authorization_code") {
      const p = deps.oauth.consumeCode(String(req.body?.code ?? ""));
      if (!p || p.redirect_uri !== String(req.body?.redirect_uri ?? "") || !deps.oauth.verifyPkce(String(req.body?.code_verifier ?? ""), p.code_challenge)) { res.status(400).json({ error: "invalid_grant" }); return; }
      const at = deps.oauth.mintAccessToken({ sub: p.sub, scope: p.scope });
      res.json({ access_token: at.token, token_type: "Bearer", expires_in: at.expiresIn, refresh_token: deps.oauth.mintRefreshToken({ sub: p.sub, scope: p.scope }), scope: p.scope });
      return;
    }
    if (grant === "refresh_token") {
      const c = deps.oauth.verifyRefreshToken(String(req.body?.refresh_token ?? ""));
      if (!c) { res.status(400).json({ error: "invalid_grant" }); return; }
      const at = deps.oauth.mintAccessToken({ sub: c.sub, scope: c.scope });
      res.json({ access_token: at.token, token_type: "Bearer", expires_in: at.expiresIn, scope: c.scope });
      return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  });

  return router;
}
```

- [ ] **Step 4: Run — PASS.** `npx vitest run test/oauth/router.test.ts`
- [ ] **Step 5: Commit** — `git add src/oauth/router.ts test/oauth/router.test.ts && git commit -m "feat(oauth): authorization-server router (register/authorize/token + metadata)"`

---

### Task 5: `/mcp` dual-auth + wiring

**Files:** Modify `src/server.ts` (dual-auth helper + buildHttpApp), `src/index.ts` (oauth key, mount router BEFORE dashboard, pass verify); Test extends `test/server.test.ts`.

- [ ] **Step 1: Failing test** — add to `test/server.test.ts`:
```ts
import { checkMcpAuth } from "../src/server.js";   // add to existing import

test("checkMcpAuth accepts the static bearer OR a valid OAuth token, rejects others", () => {
  const verify = (t: string) => t === "good-oauth";
  expect(checkMcpAuth("Bearer secret", "secret", verify)).toBe(true);     // static bearer
  expect(checkMcpAuth("Bearer good-oauth", "secret", verify)).toBe(true); // oauth
  expect(checkMcpAuth("Bearer nope", "secret", verify)).toBe(false);
  expect(checkMcpAuth(undefined, "secret", verify)).toBe(false);
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: `src/server.ts`** — add the helper and use it; extend `buildHttpApp`:
```ts
// after checkAuth:
export function checkMcpAuth(header: string | undefined, token: string, verifyOAuth?: (t: string) => boolean): boolean {
  if (checkAuth(header, token)) return true;
  if (!verifyOAuth || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return verifyOAuth(header.slice(7));
}
```
Change `buildHttpApp` signature to:
```ts
export function buildHttpApp(makeServer: () => McpServer, authToken: string, artifacts?: ArtifactStore, oauth?: { verify: (t: string) => boolean; resourceMetadataUrl: string }) {
```
and in the `/mcp` handler replace the `checkAuth(...)` guard with:
```ts
    if (!checkMcpAuth(req.headers.authorization, authToken, oauth?.verify)) {
      if (oauth) res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${oauth.resourceMetadataUrl}", scope="vault"`);
      res.status(401).json({ error: "unauthorized" });
      return;
    }
```

- [ ] **Step 4: `src/index.ts`** — wire it:
```ts
import { createOAuth } from "./oauth/tokens.js";
import { createOAuthRouter } from "./oauth/router.js";
import { createRateLimiter } from "./dashboard/rateLimit.js";
```
```ts
  const oauth = createOAuth({ signKey: loadOrCreateKey(join(config.secretsDir, "oauth"), process.env.GEODE_OAUTH_KEY), baseUrl: config.baseUrl });
  const app = buildHttpApp(
    () => buildMcpServer(queryDeps, { secrets, artifacts }),
    config.authToken,
    artifacts,
    { verify: (t) => !!oauth.verifyAccessToken(t), resourceMetadataUrl: `${config.baseUrl}/.well-known/oauth-protected-resource` },
  );
  // Mount the OAuth routes BEFORE the dashboard so /authorize, /token, /register, /.well-known/* are not
  // swallowed by the dashboard SPA fallback (which catches non-/api,/auth,/mcp,/artifacts GETs).
  app.use(createOAuthRouter({ oauth, accounts, sessionKey: loadOrCreateKey(join(config.secretsDir, "session"), process.env.GEODE_SESSION_KEY), baseUrl: config.baseUrl, secure: config.baseUrl.startsWith("https://"), rateLimit: createRateLimiter({ limit: 10, windowMs: 60_000 }) }));
```
(`accounts` already exists in `main()` from the owner-account work; reuse the same `session` key value already loaded for the dashboard — extract it to a `const sessionKey = loadOrCreateKey(join(config.secretsDir, "session"), process.env.GEODE_SESSION_KEY);` above and pass the same `sessionKey` to both the oauth router and `mountDashboard` so sessions are interchangeable.)

- [ ] **Step 5: Run** — `npx vitest run test/server.test.ts` then `npx vitest run && npx tsc --noEmit` (full backend green, tsc clean).
- [ ] **Step 6: Commit** — `git add src/server.ts src/index.ts test/server.test.ts && git commit -m "feat(oauth): /mcp dual-auth (static bearer or OAuth) + mount AS router"`

---

### Task 6: Connect page switches on the public base URL

**Files:** Modify `src/dashboard/api.ts` (`/api/connect` + `publicBaseUrl`), `web/src/api.ts`, `web/src/views/Connect.tsx`; extend `test/dashboard/api.test.ts` and `web/src/views/Connect.test.tsx`.

- [ ] **Step 1: Failing tests.** In `test/dashboard/api.test.ts`, extend the `/api/connect` test: `expect(body.publicBaseUrl).toBe("http://h")` (the boot uses `baseUrl: "http://h"`, non-loopback). In `web/src/views/Connect.test.tsx`, add a case: when `api.connect()` resolves with `publicBaseUrl: "https://v.example.com"`, the method-2 card shows `https://v.example.com/mcp` and is NOT disabled; when `publicBaseUrl: null`, it shows the managed-tunnel teaser (a "managed tunnel" / "premium" affordance).

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: `src/dashboard/api.ts`** — in the `/connect` route, compute and include `publicBaseUrl`:
```ts
  router.get("/connect", (_req, res) => {
    const isLoopback = /(^https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(deps.baseUrl);
    res.json({ mcpUrl: `${deps.baseUrl}/mcp`, authToken: deps.authToken, tools: TOOL_CATALOG, publicBaseUrl: isLoopback ? null : deps.baseUrl });
  });
```

- [ ] **Step 4: `web/src/api.ts`** — add `publicBaseUrl: string | null` to the `ConnectInfo` interface.

- [ ] **Step 5: `web/src/views/Connect.tsx`** — in the "Add with a URL" card, branch on `info.publicBaseUrl`:
  - **set** → replace the dashed placeholder with the real `\`${info.publicBaseUrl}/mcp\`` in a copyable bar, drop the "Setup required" chip (show "Ready"), keep the 3 claude.ai steps, and remove the disabled tunnel CTA (the URL is live).
  - **null** → keep the current preview, but change the CTA/label to the managed-tunnel teaser: button text "Use GeodeMCP's managed tunnel (premium)" and the note "Running on localhost — connect from claude.ai with our managed tunnel (coming soon), or set a public `GEODE_BASE_URL`." Keep the button disabled.
  (Add a `<CopyButton>` for the live URL, reusing the existing component.)

- [ ] **Step 6: Run** — `cd web && npx vitest run && npx tsc -b --noEmit && npm run build && cd ..`; and `npx vitest run test/dashboard/api.test.ts`.
- [ ] **Step 7: Commit** — `git add src/dashboard/api.ts web/src/api.ts web/src/views/Connect.tsx test/dashboard/api.test.ts web/src/views/Connect.test.tsx && git commit -m "feat(connect): live URL when public, managed-tunnel teaser on localhost"`

---

### Task 7: Docs + manual E2E + live validation

**Files:** Modify `README.md`, `test/dashboard.e2e.manual.md`.

- [ ] **Step 1: README** — add a "Connect from claude.ai (OAuth)" note: set `GEODE_BASE_URL` to your public HTTPS URL (own reverse proxy / tunnel), then in Claude → Settings → Connectors → Add custom connector → paste the URL → Connect → sign in with your owner account → Approve. Note that localhost can't be reached by claude.ai (use Claude Code/Desktop with the JSON config, or the managed tunnel later). Repeat the "create the owner + expose only connector routes before going public" security note.

- [ ] **Step 2: Manual E2E** — append a "Remote OAuth connector (manual)" section:
```markdown

## Remote OAuth connector (manual)

25. `curl -s $BASE/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` return the metadata; `$BASE` derives from `GEODE_BASE_URL`.
26. `curl -i $BASE/mcp` with no auth → `401` + a `WWW-Authenticate: Bearer resource_metadata="…"` header. With `Authorization: Bearer $GEODE_AUTH_TOKEN` → not 401 (static bearer still works).
27. End-to-end against claude.ai (needs a public URL — use a throwaway `cloudflared`/`ngrok` and set `GEODE_BASE_URL` to it; create the owner first): Claude → Connectors → Add custom connector → paste the URL → it discovers metadata + self-registers (DCR) → opens the consent page → sign in with the owner account → Approve → connected. Confirm the 4 tools appear and a `query` runs over the OAuth token.
28. A forged/expired access token on `/mcp` → 401. Deny on the consent page → Claude shows the connection was declined.
```

- [ ] **Step 3: Live validation** — `cd web && npm run build && cd ..`; run the kernel behind a throwaway tunnel with `GEODE_BASE_URL` set to the public URL and an owner created; perform steps 25–28. Then confirm the Connect page (method 2) shows the live URL when `GEODE_BASE_URL` is public.
- [ ] **Step 4: Commit** — `git add README.md test/dashboard.e2e.manual.md && git commit -m "docs: OAuth connector — claude.ai connect flow + manual E2E"`

---

## Self-review notes

- **Spec coverage:** tokens/codes/PKCE (T1); metadata (T2); consent screen (T3); register/authorize/token router with account-login consent (T4); `/mcp` dual-auth + 401 `WWW-Authenticate` + mount (T5); Connect-page live-vs-teaser switch (T6); docs + claude.ai validation (T7). ✔
- **Account-only alignment:** `/authorize` authenticates via `AccountStore.verify` + `geode_session` `sub`; codes/tokens carry `sub`. Reuses the owner-account sub-project.
- **Mount ordering gotcha (T5):** the OAuth router MUST be mounted before `mountDashboard`, else the SPA fallback (`/^\/(?!api\/|auth\/|mcp$|artifacts\/).*/`) swallows `/authorize`, `/token`, `/register`, `/.well-known/*`. Same `sessionKey` is shared between the OAuth router and the dashboard so sessions interoperate.
- **Type consistency:** `OAuth`/`ClientReg`/`CodePayload`/`AuthRequest`/`TokenClaims` defined once in `tokens.ts`; `buildHttpApp`'s new optional `oauth` arg is `{ verify, resourceMetadataUrl }`; `ConnectInfo` gains `publicBaseUrl` on both ends.
- **Deferred:** managed tunnel service (Path 2); token revocation + connected-clients UI; Client ID Metadata Documents; multi-scope; multi-user.
```

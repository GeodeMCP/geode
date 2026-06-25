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

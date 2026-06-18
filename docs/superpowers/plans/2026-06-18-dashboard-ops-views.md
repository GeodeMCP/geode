# Dashboard Increment B (Ops views) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the four top-bar operator views — Capabilities, Integrations (list + detail + per-action `invoke` test), Secrets (write-only + §5.9 signed-link entry), Artifacts — on top of the Increment-A dashboard.

**Architecture:** Extend the dashboard's first-party `/api` with read/manage routes that reuse the existing kernel modules (`deriveCapabilities`, `loadIntegration`, `invoke`, the secret broker, the artifact store) — no MCP hop. Secret *entry* never goes through `/api`: it uses a signed, scoped, single-use, expiring **§5.9 link** to a standalone server-rendered auth screen (`/auth/s/<token>`) that writes straight into the broker. The SPA gains client-side view routing (the top-bar nav) and four new views, reusing the committed `docs/design/app.css` + mockups (`connection-detail.html`, `auth-screen.html`). Secrets are **write-only** (set/rotate/delete, never shown).

**Tech Stack:** Existing kernel stack (Node/TS NodeNext ESM, `express` v5, `vitest`, Node `crypto`) + the `web/` React/Vite SPA from Increment A. No new deps.

Spec: `docs/superpowers/specs/2026-06-18-dashboard-design.md` (Increment B = §4.2–4.6, §11). Reuses: `src/capabilities.ts` (`deriveCapabilities`), `src/integrations.ts` (`loadIntegration`), `src/invoke.ts` (`invoke`), `src/secrets.ts` (`SecretStore`), `src/artifacts.ts` (`ArtifactStore`).

---

## File Structure
| Path | Responsibility |
|---|---|
| `src/dashboard/secretLinks.ts` (create) | `mintSecretLink`/`verifySecretLink` — signed scoped single-use expiring tokens (HMAC) |
| `src/dashboard/ops.ts` (create) | `listIntegrations`/`getIntegration` (manifest + composed credential status), `listSecrets` (refs + requiredBy), `listArtifacts` (paths) |
| `src/dashboard/authScreen.ts` (create) | `renderAuthScreen`/`renderAuthResult` — standalone server-rendered §5.9 page (HTML strings) |
| `src/dashboard/api.ts` (modify) | extend `ApiDeps`; add routes: capabilities, integrations (list/detail/test), secrets (list/link/delete), artifacts (list/download/public-link) |
| `src/dashboard/index.ts` (modify) | mount `/auth/s/*` (no session) with an in-memory single-use registry; exclude `/auth/` from the SPA fallback |
| `src/index.ts` (modify) | pass `secrets`, `artifacts`, `artifactsDir`, `baseUrl`, `invoke`, `linkKey` into `mountDashboard` |
| `web/src/api.ts` (modify) | add client methods for the new endpoints |
| `web/src/App.tsx` (modify) | view-routing shell (`AppShell`) |
| `web/src/components/TopBar.tsx` (modify) | clickable nav driving the active view |
| `web/src/views/VaultHome.tsx` (modify) | drop its own TopBar/outer shell (now provided by `AppShell`) |
| `web/src/views/{Capabilities,Integrations,Secrets,Artifacts}.tsx` (create) | the four ops views |
| `test/dashboard/{secretLinks,ops,authScreen,api-ops}.test.ts` (create) | unit + booted-app tests |
| `test/dashboard.e2e.manual.md` (modify) | extend with the Increment-B flow |

---

## Task 1: Secret links (`src/dashboard/secretLinks.ts`)

**Files:** create `src/dashboard/secretLinks.ts`, `test/dashboard/secretLinks.test.ts`.

- [ ] **Step 1: Failing test** `test/dashboard/secretLinks.test.ts`:
```typescript
import { expect, test } from "vitest";
import { mintSecretLink, verifySecretLink } from "../../src/dashboard/secretLinks.js";

const key = Buffer.from("k".repeat(32));

test("mint → verify round-trip returns the ref; tampered/expired/garbage fail", () => {
  const now = 1_000_000;
  const tok = mintSecretLink(key, "NOTION_TOKEN", 60_000, () => now);
  const claims = verifySecretLink(key, tok, () => now);
  expect(claims?.ref).toBe("NOTION_TOKEN");
  expect(typeof claims?.nonce).toBe("string");
  expect(verifySecretLink(key, tok + "x", () => now)).toBeNull();        // tampered sig
  expect(verifySecretLink(key, tok, () => now + 61_000)).toBeNull();      // expired
  expect(verifySecretLink(key, "not-a-token", () => now)).toBeNull();     // garbage
});

test("each mint has a distinct nonce (single-use is enforced by the caller via the nonce)", () => {
  const a = mintSecretLink(key, "K", 60_000);
  const b = mintSecretLink(key, "K", 60_000);
  expect(verifySecretLink(key, a)!.nonce).not.toBe(verifySecretLink(key, b)!.nonce);
});
```
- [ ] **Step 2: Run** `npx vitest run test/dashboard/secretLinks.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/dashboard/secretLinks.ts`:
```typescript
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface SecretLinkClaims { ref: string; exp: number; nonce: string }

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/** A signed, scoped, single-use, expiring token for entering secret <ref>. The token never carries the value. */
export function mintSecretLink(key: Buffer, ref: string, ttlMs: number, now: () => number = Date.now): string {
  const claims: SecretLinkClaims = { ref, exp: now() + ttlMs, nonce: randomBytes(9).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

export function verifySecretLink(key: Buffer, token: string, now: () => number = Date.now): SecretLinkClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = sign(key, payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: SecretLinkClaims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (typeof claims.ref !== "string" || typeof claims.exp !== "number" || typeof claims.nonce !== "string") return null;
  if (claims.exp < now()) return null;
  return claims;
}
```
- [ ] **Step 4: Run** → PASS (2). **Step 5: Commit** `git add src/dashboard/secretLinks.ts test/dashboard/secretLinks.test.ts && git commit -m "feat(dashboard): signed single-use secret-entry links"`

---

## Task 2: Ops data helpers (`src/dashboard/ops.ts`)

**Files:** create `src/dashboard/ops.ts`, `test/dashboard/ops.test.ts`.

- [ ] **Step 1: Failing test** `test/dashboard/ops.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIntegrations, listSecrets, listArtifacts } from "../../src/dashboard/ops.js";

let root: string;
const fakeSecrets = (refs: string[]) => ({ list: async () => refs } as any);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-ops-"));
  mkdirSync(join(root, "integrations", "moneybird"), { recursive: true });
  writeFileSync(join(root, "integrations", "moneybird", "manifest.json"), JSON.stringify({
    name: "moneybird", type: "connection", description: "boekhouding", requires: ["MONEYBIRD_API_KEY"],
    actions: { create_invoice: { method: "POST", url: "https://api/x", description: "maak factuur" } },
  }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("listIntegrations composes credential status from the broker", async () => {
  const none = await listIntegrations(root, fakeSecrets([]));
  expect(none[0]).toMatchObject({ name: "moneybird", type: "connection" });
  expect(none[0].actions[0]).toMatchObject({ name: "create_invoice", method: "POST" });
  expect(none[0].requiredSecrets).toEqual([{ ref: "MONEYBIRD_API_KEY", set: false }]);
  const set = await listIntegrations(root, fakeSecrets(["MONEYBIRD_API_KEY"]));
  expect(set[0].requiredSecrets[0].set).toBe(true);
});

test("listSecrets reports which integrations require each ref (no values)", async () => {
  expect(await listSecrets(root, fakeSecrets(["MONEYBIRD_API_KEY"]))).toEqual([
    { ref: "MONEYBIRD_API_KEY", requiredBy: ["moneybird"] },
  ]);
});

test("listArtifacts lists files recursively as relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-art-"));
  mkdirSync(join(dir, "sub")); writeFileSync(join(dir, "a.md"), "x"); writeFileSync(join(dir, "sub", "b.md"), "y");
  expect(listArtifacts(dir).map((a) => a.path).sort()).toEqual(["a.md", "sub/b.md"]);
  rmSync(dir, { recursive: true, force: true });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/dashboard/ops.ts`:
```typescript
import { readdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SecretStore } from "../secrets.js";
import { loadIntegration, type IntegrationManifest } from "../integrations.js";

export interface IntegrationView {
  name: string; type: string; description: string;
  actions: { name: string; method: string; url: string; description?: string }[];
  requiredSecrets: { ref: string; set: boolean }[];
}

function toView(m: IntegrationManifest, setRefs: Set<string>): IntegrationView {
  return {
    name: m.name, type: m.type ?? "connection", description: m.description ?? "",
    actions: Object.entries(m.actions ?? {}).map(([name, a]) => ({ name, method: a.method, url: a.url, description: a.description })),
    requiredSecrets: (m.requires ?? []).map((ref) => ({ ref, set: setRefs.has(ref) })),
  };
}

export async function listIntegrations(root: string, secrets: Pick<SecretStore, "list">): Promise<IntegrationView[]> {
  let dirs: string[] = [];
  try { dirs = (await readdir(join(root, "integrations"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
  const setRefs = new Set(await secrets.list());
  const out: IntegrationView[] = [];
  for (const name of dirs) {
    try { out.push(toView(await loadIntegration(root, name), setRefs)); } catch { /* skip malformed */ }
  }
  return out;
}

export async function getIntegration(root: string, name: string, secrets: Pick<SecretStore, "list">): Promise<IntegrationView> {
  return toView(await loadIntegration(root, name), new Set(await secrets.list()));
}

export async function listSecrets(root: string, secrets: Pick<SecretStore, "list">): Promise<{ ref: string; requiredBy: string[] }[]> {
  const refs = await secrets.list();
  const ints = await listIntegrations(root, secrets);
  return refs.map((ref) => ({ ref, requiredBy: ints.filter((i) => i.requiredSecrets.some((s) => s.ref === ref)).map((i) => i.name) }));
}

export function listArtifacts(dir: string): { path: string }[] {
  if (!existsSync(dir)) return [];
  const out: { path: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).split(sep).join("/") });
    }
  };
  walk(dir);
  return out;
}
```
- [ ] **Step 4: Run** → PASS (3). **Step 5: Commit** `git add src/dashboard/ops.ts test/dashboard/ops.test.ts && git commit -m "feat(dashboard): ops data helpers (integrations/secrets/artifacts)"`

---

## Task 3: Auth screen render (`src/dashboard/authScreen.ts`)

**Files:** create `src/dashboard/authScreen.ts`, `test/dashboard/authScreen.test.ts`. Standalone server-rendered page (no JS required) ported from `docs/design/mockups/auth-screen.html` (API-key variant). The form POSTs `value` to the same URL.

- [ ] **Step 1: Failing test** `test/dashboard/authScreen.test.ts`:
```typescript
import { expect, test } from "vitest";
import { renderAuthScreen, renderAuthResult } from "../../src/dashboard/authScreen.js";

test("renderAuthScreen shows the ref, posts to the action URL, has a value field, and never echoes a value", () => {
  const html = renderAuthScreen({ ref: "NOTION_TOKEN", action: "/auth/s/abc", minutesLeft: 9 });
  expect(html).toContain("NOTION_TOKEN");
  expect(html).toContain('action="/auth/s/abc"');
  expect(html).toContain('method="post"');
  expect(html).toContain('name="value"');
  expect(html).toContain("9 min");
});

test("renderAuthResult reflects success/failure", () => {
  expect(renderAuthResult({ ok: true, ref: "K", message: "opgeslagen" })).toContain("opgeslagen");
  expect(renderAuthResult({ ok: false, ref: "", message: "verlopen" })).toContain("verlopen");
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/dashboard/authScreen.ts` (self-contained HTML; tokens inline so the page needs no external CSS; `esc` prevents injection of the ref/message):
```typescript
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const SHELL = (body: string) => `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Geode — secret</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&family=Onest:wght@500&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0f0e;--surface:#141917;--input:#080b0a;--text:#f2f2f2;--muted:#a3a3a3;--faint:#777;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.12);--green:#34d399;--emerald-300:#6ee7b7;--amber:#d9a13a;--blue:#2563eb;--blue-500:#3b82f6;--blue-100:#dbeafe;}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:"Geist",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.name{font-family:"Onest",sans-serif;font-weight:500;font-size:19px;letter-spacing:-.02em;margin-bottom:14px}
.card{width:460px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px}
.eyebrow{font-family:"Instrument Sans";font-size:11px;text-transform:uppercase;letter-spacing:.17em;font-weight:600;color:var(--green)}
h2{font-family:"Instrument Sans";font-weight:600;font-size:21px;letter-spacing:-.02em;margin:6px 0 4px}
.validity{display:inline-flex;gap:8px;align-items:center;font-family:"Instrument Sans";font-size:12.5px;color:var(--muted);border:1px solid var(--border-strong);border-radius:999px;padding:5px 12px;margin:12px 0 16px}
.label{font-family:"Geist Mono",monospace;font-size:12.5px;color:var(--emerald-300);display:block;margin-bottom:7px}
input{width:100%;background:var(--input);border:1px solid var(--border-strong);border-radius:9px;padding:12px 13px;color:var(--text);font-family:"Geist Mono",monospace;font-size:14px}
.note{display:flex;gap:9px;color:var(--faint);font-size:12.5px;line-height:1.5;margin:14px 0 18px}
.btn{width:100%;font-family:"Instrument Sans";font-weight:500;font-size:14.5px;background:var(--blue);border:1px solid var(--blue-500);color:var(--blue-100);border-radius:8px;padding:12px 16px;cursor:pointer}
.err{color:#eaa;font-size:13px;margin:6px 0}
.ok{color:var(--green)}
</style></head><body><div class="name">Geode</div>${body}</body></html>`;

export function renderAuthScreen(opts: { ref: string; action: string; minutesLeft: number; error?: string }): string {
  const ref = esc(opts.ref);
  return SHELL(`<form class="card" method="post" action="${esc(opts.action)}">
    <span class="eyebrow">Secret toevoegen</span>
    <h2>${ref}</h2>
    <div class="validity">Verloopt over ${opts.minutesLeft} min · eenmalig bruikbaar</div>
    <label class="label">${ref}</label>
    <input type="password" name="value" placeholder="Plak de waarde…" autocomplete="off" autofocus>
    ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
    <div class="note">Gaat rechtstreeks de broker in en wordt versleuteld opgeslagen. De agent ziet deze waarde nooit — alleen de referentie ${ref}.</div>
    <button class="btn" type="submit">Opslaan in broker</button>
  </form>`);
}

export function renderAuthResult(opts: { ok: boolean; ref: string; message: string }): string {
  return SHELL(`<div class="card">
    <span class="eyebrow">${opts.ok ? "Gelukt" : "Niet gelukt"}</span>
    <h2 class="${opts.ok ? "ok" : ""}">${opts.ok ? esc(opts.ref) : "Link ongeldig"}</h2>
    <p style="color:var(--muted);font-size:14px">${esc(opts.message)}</p>
  </div>`);
}
```
- [ ] **Step 4: Run** → PASS (2). **Step 5: Commit** `git add src/dashboard/authScreen.ts test/dashboard/authScreen.test.ts && git commit -m "feat(dashboard): server-rendered §5.9 secret-entry auth screen"`

---

## Task 4: Ops `/api` routes

**Files:** modify `src/dashboard/api.ts`; create `test/dashboard/api-ops.test.ts`.

- [ ] **Step 1: Failing test** `test/dashboard/api-ops.test.ts` (boots a real app like the Increment-A api test; uses a fake secret store, a real integration manifest, a fake invoke + artifact store):
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";

let server: Server; let url: string; let root: string; let artDir: string;
const KEY = Buffer.from("k".repeat(32));
const secretRefs: string[] = [];

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-apiops-"));
  artDir = mkdtempSync(join(tmpdir(), "geode-apiops-art-"));
  writeFileSync(join(artDir, "report.md"), "hello");
  const ws = createWorkspace(root); await ws.init();
  mkdirSync(join(root, "integrations", "demo"), { recursive: true });
  writeFileSync(join(root, "integrations", "demo", "manifest.json"), JSON.stringify({
    name: "demo", type: "connection", description: "d", requires: ["DEMO_KEY"], actions: { ping: { method: "GET", url: "https://h/p" } },
  }));
  const app = express(); app.use(express.json());
  app.use("/api", createApiRouter({
    sessionKey: KEY, dashboardPassword: "pw", secure: false, workspace: ws, linkKey: KEY,
    runQuery: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    secrets: { list: async () => secretRefs, get: async () => null, set: async () => {}, delete: async (r: string) => { const i = secretRefs.indexOf(r); if (i >= 0) secretRefs.splice(i, 1); } } as any,
    artifacts: { mintPublicUrl: (p: string) => `http://h/artifacts/${p}?sig=x&exp=1`, resolve: (p: string) => join(artDir, p) } as any,
    artifactsDir: artDir, baseUrl: "http://h",
    invoke: async (a: any) => ({ status: 200, body: { echoed: a.action } }),
  }));
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
const login = async () => (await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw" }) })).headers.get("set-cookie")!.split(";")[0];

beforeEach(async () => { secretRefs.length = 0; await boot(); });
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); rmSync(artDir, { recursive: true, force: true }); });

test("integrations list/detail compose credential status; test calls invoke", async () => {
  const cookie = await login();
  const list = await (await fetch(`${url}/api/integrations`, { headers: { cookie } })).json();
  expect(list[0]).toMatchObject({ name: "demo", type: "connection" });
  expect(list[0].requiredSecrets).toEqual([{ ref: "DEMO_KEY", set: false }]);
  const test = await (await fetch(`${url}/api/integrations/demo/test`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "ping" }) })).json();
  expect(test).toEqual({ status: 200, body: { echoed: "ping" } });
});

test("secrets: mint link, list requiredBy, delete", async () => {
  const cookie = await login();
  secretRefs.push("DEMO_KEY");
  const sec = await (await fetch(`${url}/api/secrets`, { headers: { cookie } })).json();
  expect(sec).toEqual([{ ref: "DEMO_KEY", requiredBy: ["demo"] }]);
  const link = await (await fetch(`${url}/api/secrets/NEW_KEY/link`, { method: "POST", headers: { cookie } })).json();
  expect(link.url).toContain("/auth/s/");
  const del = await fetch(`${url}/api/secrets/DEMO_KEY`, { method: "DELETE", headers: { cookie } });
  expect((await del.json()).ok).toBe(true);
  expect(secretRefs).toEqual([]);
});

test("artifacts list + download + public-link", async () => {
  const cookie = await login();
  const arts = await (await fetch(`${url}/api/artifacts`, { headers: { cookie } })).json();
  expect(arts).toEqual([{ path: "report.md" }]);
  const dl = await fetch(`${url}/api/artifacts/download?path=report.md`, { headers: { cookie } });
  expect(await dl.text()).toBe("hello");
  const pub = await (await fetch(`${url}/api/artifacts/public-link`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "report.md" }) })).json();
  expect(pub.url).toContain("sig=");
});

test("capabilities renders the derived menu", async () => {
  const cookie = await login();
  const cap = await (await fetch(`${url}/api/capabilities`, { headers: { cookie } })).json();
  expect(cap.integrations.map((i: any) => i.name)).toContain("demo");
});
```
- [ ] **Step 2: Run** `npx vitest run test/dashboard/api-ops.test.ts` → FAIL.
- [ ] **Step 3: Implement** — in `src/dashboard/api.ts`:

Add imports at the top:
```typescript
import type { SecretStore } from "../secrets.js";
import type { ArtifactStore } from "../artifacts.js";
import { deriveCapabilities } from "../capabilities.js";
import { listIntegrations, getIntegration, listSecrets, listArtifacts } from "./ops.js";
import { mintSecretLink } from "./secretLinks.js";
```
Extend `ApiDeps` with:
```typescript
  linkKey: Buffer;
  secrets: Pick<SecretStore, "list" | "delete" | "set">;
  artifacts: Pick<ArtifactStore, "mintPublicUrl" | "resolve">;
  artifactsDir: string;
  baseUrl: string;
  invoke: (args: { integration: string; action: string; params?: Record<string, unknown> }) => Promise<{ status: number; body: unknown }>;
```
Add these routes (after the existing `/discard` route, still inside `createApiRouter`, all under `requireSession`):
```typescript
  router.get("/capabilities", async (_req, res) => { res.json(await deriveCapabilities(deps.workspace.root)); });

  router.get("/integrations", async (_req, res) => { res.json(await listIntegrations(deps.workspace.root, deps.secrets)); });
  router.get("/integrations/:name", async (req, res) => {
    try { res.json(await getIntegration(deps.workspace.root, req.params.name, deps.secrets)); }
    catch { res.status(404).json({ error: "unknown integration" }); }
  });
  router.post("/integrations/:name/test", async (req, res) => {
    try { res.json(await deps.invoke({ integration: req.params.name, action: String(req.body?.action ?? ""), params: req.body?.params ?? {} })); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  router.get("/secrets", async (_req, res) => { res.json(await listSecrets(deps.workspace.root, deps.secrets)); });
  router.post("/secrets/:ref/link", (req, res) => {
    res.json({ url: `${deps.baseUrl}/auth/s/${mintSecretLink(deps.linkKey, req.params.ref, 600_000)}` });
  });
  router.delete("/secrets/:ref", async (req, res) => { await deps.secrets.delete(req.params.ref); res.json({ ok: true }); });

  router.get("/artifacts", async (_req, res) => { res.json(listArtifacts(deps.artifactsDir)); });
  router.get("/artifacts/download", (req, res) => {
    try { res.sendFile(deps.artifacts.resolve(String(req.query.path ?? "")), (err) => { if (err && !res.headersSent) res.status(404).json({ error: "not found" }); }); }
    catch { res.status(400).json({ error: "bad path" }); }
  });
  router.post("/artifacts/public-link", (req, res) => {
    try { res.json({ url: deps.artifacts.mintPublicUrl(String(req.body?.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
```
- [ ] **Step 4: Run** `npx vitest run test/dashboard/api-ops.test.ts test/dashboard/api.test.ts` → PASS (existing api test still green). Then `npm test` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `git add src/dashboard/api.ts test/dashboard/api-ops.test.ts && git commit -m "feat(dashboard): ops /api routes (capabilities, integrations+test, secrets, artifacts)"`

---

## Task 5: Mount `/auth/s/*` + wire deps

**Files:** modify `src/dashboard/index.ts`, `src/index.ts`; create `test/dashboard/authRoute.test.ts`.

- [ ] **Step 1: Failing test** `test/dashboard/authRoute.test.ts` (boots `mountDashboard` with a temp secret store; drives the §5.9 page end-to-end incl. single-use):
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountDashboard } from "../../src/dashboard/index.js";
import { createWorkspace } from "../../src/workspace.js";
import { mintSecretLink } from "../../src/dashboard/secretLinks.js";

let server: Server; let url: string; let root: string;
const KEY = Buffer.from("k".repeat(32));
const stored: Record<string, string> = {};

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-authrt-"));
  const ws = createWorkspace(root); await ws.init();
  const app = express(); app.use(express.json());
  mountDashboard(app, {
    sessionKey: KEY, dashboardPassword: "pw", workspace: ws, webDir: "/nonexistent", linkKey: KEY,
    runQuery: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    secrets: { list: async () => Object.keys(stored), get: async () => null, set: async (r: string, v: string) => { stored[r] = v; }, delete: async () => {} } as any,
    artifacts: {} as any, artifactsDir: root, baseUrl: "http://h",
    invoke: async () => ({ status: 200, body: {} }),
  });
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
beforeEach(async () => { for (const k of Object.keys(stored)) delete stored[k]; await boot(); });
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("GET renders the auth screen; POST stores the secret; the link is single-use", async () => {
  const token = mintSecretLink(KEY, "NOTION_TOKEN", 600_000);
  const page = await fetch(`${url}/auth/s/${token}`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("NOTION_TOKEN");
  const post = await fetch(`${url}/auth/s/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=secret-xyz" });
  expect(post.status).toBe(200);
  expect(stored.NOTION_TOKEN).toBe("secret-xyz");
  // single-use: a second POST is refused (410)
  const again = await fetch(`${url}/auth/s/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=second" });
  expect(again.status).toBe(410);
});

test("an invalid/expired token yields 410", async () => {
  expect((await fetch(`${url}/auth/s/garbage`)).status).toBe(410);
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in `src/dashboard/index.ts`:

Add imports:
```typescript
import { verifySecretLink } from "./secretLinks.js";
import { renderAuthScreen, renderAuthResult } from "./authScreen.js";
```
Inside `mountDashboard`, **before** the static/fallback block, add the auth router (no session — it's a capability link) with an in-memory single-use registry:
```typescript
  const authRouter = express.Router();
  authRouter.use(express.urlencoded({ extended: false }));
  const consumed = new Set<string>();
  const expired = () => ({ html: renderAuthResult({ ok: false, ref: "", message: "Deze link is verlopen of al gebruikt." }) });
  authRouter.get("/s/:token", (req, res) => {
    const c = verifySecretLink(deps.linkKey, req.params.token);
    if (!c || consumed.has(c.nonce)) { res.status(410).type("html").send(expired().html); return; }
    const minutesLeft = Math.max(1, Math.ceil((c.exp - Date.now()) / 60000));
    res.type("html").send(renderAuthScreen({ ref: c.ref, action: req.originalUrl, minutesLeft }));
  });
  authRouter.post("/s/:token", async (req, res) => {
    const c = verifySecretLink(deps.linkKey, req.params.token);
    if (!c || consumed.has(c.nonce)) { res.status(410).type("html").send(expired().html); return; }
    const value = String((req.body as { value?: string })?.value ?? "");
    if (!value) { res.type("html").send(renderAuthScreen({ ref: c.ref, action: req.originalUrl, minutesLeft: 1, error: "Voer een waarde in." })); return; }
    await deps.secrets.set(c.ref, value);
    consumed.add(c.nonce);
    res.type("html").send(renderAuthResult({ ok: true, ref: c.ref, message: `${c.ref} is opgeslagen in de broker.` }));
  });
  app.use("/auth", authRouter);
```
Also extend the `DashboardDeps` interface note: it already `extends Omit<ApiDeps, "secure">`, so the new `ApiDeps` fields (linkKey/secrets/artifacts/artifactsDir/baseUrl/invoke) flow through automatically — no change needed there beyond ensuring `secrets.set` is available (the `Pick<SecretStore,...>` in ApiDeps already includes `set`).

**Exclude `/auth/` from the SPA fallback** — change BOTH fallback regexes in `mountDashboard` from `/^\/(?!api\/|mcp$|artifacts\/).*/` to `/^\/(?!api\/|auth\/|mcp$|artifacts\/).*/`.

- [ ] **Step 4: Wire `src/index.ts`** — add `import { invoke } from "./invoke.js";`, then in the `mountDashboard({...})` call (added in Increment A) add these fields:
```typescript
      secrets,
      artifacts,
      artifactsDir: config.artifactsDir,
      baseUrl: config.baseUrl,
      invoke: (args) => invoke({ root: workspace.root, secrets }, args),
      linkKey: loadOrCreateKey(join(config.secretsDir, "link"), process.env.GEODE_LINK_KEY),
```
(`secrets` and `artifacts` are already constructed earlier in `main()` for the MCP/artifacts wiring; reuse them. `loadOrCreateKey` and `join` are already imported from Increment A.)

- [ ] **Step 5: Run** `npx vitest run test/dashboard/authRoute.test.ts` → PASS. Then `npm test` + `npx tsc --noEmit`.
- [ ] **Step 6: Boot smoke** (the §5.9 page is reachable without a session):
```bash
GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=$(mktemp -d) GEODE_DASHBOARD_PASSWORD=pw GEODE_SECRETS_DIR=$(mktemp -d) npx tsx src/index.ts &
sleep 2
# mint a link via the API (needs login), or just confirm an obviously-bad token is 410:
curl -s -o /dev/null -w "bad-auth-link=%{http_code}\n" http://localhost:8787/auth/s/garbage    # expect 410
kill %1 2>/dev/null
```
Expected: `bad-auth-link=410`.
- [ ] **Step 7: Commit** `git add src/dashboard/index.ts src/index.ts test/dashboard/authRoute.test.ts && git commit -m "feat(dashboard): mount §5.9 secret-entry route (single-use) + wire ops deps"`

---

## Task 6: SPA — client methods + view-routing shell

**Files:** modify `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/TopBar.tsx`, `web/src/views/VaultHome.tsx`.

- [ ] **Step 1: Extend `web/src/api.ts`** — add these types + methods to the `api` object:
```typescript
export interface IntegrationView { name: string; type: string; description: string; actions: { name: string; method: string; url: string; description?: string }[]; requiredSecrets: { ref: string; set: boolean }[] }
```
Add inside `api = { ... }`:
```typescript
  capabilities: () => json<{ integrations: { name: string; description: string; actions: string[] }[]; recipes: { title: string; description: string; path: string }[] }>("/api/capabilities"),
  integrations: () => json<IntegrationView[]>("/api/integrations"),
  integration: (name: string) => json<IntegrationView>(`/api/integrations/${encodeURIComponent(name)}`),
  testAction: (name: string, action: string, params: Record<string, unknown>) => json<{ status: number; body: unknown }>(`/api/integrations/${encodeURIComponent(name)}/test`, { method: "POST", body: JSON.stringify({ action, params }) }),
  secrets: () => json<{ ref: string; requiredBy: string[] }[]>("/api/secrets"),
  secretLink: (ref: string) => json<{ url: string }>(`/api/secrets/${encodeURIComponent(ref)}/link`, { method: "POST" }),
  deleteSecret: (ref: string) => json<{ ok: true }>(`/api/secrets/${encodeURIComponent(ref)}`, { method: "DELETE" }),
  artifacts: () => json<{ path: string }[]>("/api/artifacts"),
  artifactDownload: (path: string) => `/api/artifacts/download?path=${encodeURIComponent(path)}`,
  artifactPublicLink: (path: string) => json<{ url: string }>("/api/artifacts/public-link", { method: "POST", body: JSON.stringify({ path }) }),
```
- [ ] **Step 2: Refactor `web/src/views/VaultHome.tsx`** — it currently renders `<div style={{display:flex,flexDirection:column,height:100vh}}><TopBar/><div className="main">…</div></div>`. Remove the outer wrapper **and** the `<TopBar />` (the shell now owns them). Return only `<div className="main"> … the three columns … </div>`. Remove the now-unused `import { TopBar }`.
- [ ] **Step 3: Rewrite `web/src/components/TopBar.tsx`** to drive routing:
```tsx
export const VIEWS = ["Vault", "Capabilities", "Integrations", "Secrets", "Artifacts"] as const;
export type View = typeof VIEWS[number];
export function TopBar({ view, onNav }: { view: View; onNav: (v: View) => void }) {
  return (
    <div className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="12,2 22,9 12,22" fill="#3FCFA1"/><polygon points="12,2 2,9 12,22" fill="#86ECCB"/><polygon points="2,9 12,22 22,9" fill="#4C7DF4" opacity=".85"/></svg>
        <span className="name">Geode</span>
        <span className="ws">personal-vault</span>
      </div>
      <nav>{VIEWS.map((v) => <a key={v} className={v === view ? "active" : ""} onClick={() => onNav(v)} style={{ cursor: "pointer" }}>{v}</a>)}</nav>
      <div className="tb-right"><span className="chip live"><span className="pulse" />live</span><span className="avatar" /></div>
    </div>
  );
}
```
- [ ] **Step 4: Rewrite `web/src/App.tsx`** as the routing shell:
```tsx
import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./views/Login";
import { TopBar, type View } from "./components/TopBar";
import { VaultHome } from "./views/VaultHome";
import { Capabilities } from "./views/Capabilities";
import { Integrations } from "./views/Integrations";
import { Secrets } from "./views/Secrets";
import { Artifacts } from "./views/Artifacts";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("Vault");
  useEffect(() => { api.tree().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return null;
  if (!authed) return <Login onIn={() => setAuthed(true)} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar view={view} onNav={setView} />
      {view === "Vault" && <VaultHome />}
      {view === "Capabilities" && <Capabilities />}
      {view === "Integrations" && <Integrations />}
      {view === "Secrets" && <Secrets />}
      {view === "Artifacts" && <Artifacts />}
    </div>
  );
}
```
(Views are created in Tasks 7–8; create empty stub components first so the build passes after this task, OR do Step 4 last. To keep each task green, create minimal stubs now: each `export function X() { return <div className="wrap" style={{padding:24}}>…</div>; }` then flesh out in 7–8.)
- [ ] **Step 5:** Create stub files `web/src/views/Capabilities.tsx`, `Integrations.tsx`, `Secrets.tsx`, `Artifacts.tsx`, each exporting a function returning a placeholder `<div className="eyebrow" style={{padding:20}}>…</div>`. `cd web && npm run build` → succeeds; `npx vitest run` → api test still green.
- [ ] **Step 6: Commit** `git add web/src && git commit -m "feat(dashboard): SPA view-routing shell + ops client methods"`

---

## Task 7: SPA — Capabilities + Artifacts views

**Files:** rewrite `web/src/views/Capabilities.tsx`, `web/src/views/Artifacts.tsx`.

- [ ] **Step 1: `web/src/views/Capabilities.tsx`** — read-only derived menu:
```tsx
import { useEffect, useState } from "react";
import { api } from "../api";
export function Capabilities() {
  const [cap, setCap] = useState<Awaited<ReturnType<typeof api.capabilities>> | null>(null);
  useEffect(() => { api.capabilities().then(setCap).catch(() => setCap({ integrations: [], recipes: [] })); }, []);
  if (!cap) return null;
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Integraties</div>
      {cap.integrations.length === 0 && <p style={{ color: "var(--faint)" }}>Nog geen integraties.</p>}
      {cap.integrations.map((i) => (
        <div key={i.name} className="card" style={{ display: "block", marginBottom: 10 }}>
          <strong>{i.name}</strong> <span style={{ color: "var(--muted)" }}>— {i.description}</span>
          <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 12, color: "var(--emerald-300)", marginTop: 4 }}>{i.actions.join(" · ")}</div>
        </div>
      ))}
      <div className="eyebrow" style={{ marginTop: 24 }}>Recepten &amp; skills</div>
      {cap.recipes.length === 0 && <p style={{ color: "var(--faint)" }}>Nog geen recepten.</p>}
      {cap.recipes.map((r) => (
        <div key={r.path} className="card" style={{ display: "block", marginBottom: 10 }}><strong>{r.title}</strong> <span style={{ color: "var(--muted)" }}>— {r.description}</span></div>
      ))}
    </div>
  );
}
```
- [ ] **Step 2: `web/src/views/Artifacts.tsx`** — list + download + share (public link):
```tsx
import { useEffect, useState } from "react";
import { api } from "../api";
export function Artifacts() {
  const [items, setItems] = useState<{ path: string }[]>([]);
  const [shared, setShared] = useState<Record<string, string>>({});
  useEffect(() => { api.artifacts().then(setItems).catch(() => setItems([])); }, []);
  const share = async (path: string) => { const { url } = await api.artifactPublicLink(path); setShared((s) => ({ ...s, [path]: url })); };
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Artifacts</div>
      {items.length === 0 && <p style={{ color: "var(--faint)" }}>Nog geen artifacts.</p>}
      {items.map((a) => (
        <div key={a.path} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <span className="fname" style={{ flex: 1 }}>{a.path}</span>
          <a className="ghost" href={api.artifactDownload(a.path)} target="_blank" rel="noreferrer">Download</a>
          <button className="ghost" onClick={() => share(a.path)}>Deel-link</button>
          {shared[a.path] && <input className="input" readOnly value={shared[a.path]} style={{ flexBasis: "100%" }} onFocus={(e) => e.currentTarget.select()} />}
        </div>
      ))}
    </div>
  );
}
```
- [ ] **Step 3:** `cd web && npm run build` → succeeds. **Step 4: Commit** `git add web/src/views/Capabilities.tsx web/src/views/Artifacts.tsx && git commit -m "feat(dashboard): Capabilities + Artifacts views"`

---

## Task 8: SPA — Integrations + Secrets views

**Files:** rewrite `web/src/views/Integrations.tsx`, `web/src/views/Secrets.tsx`. Port styling cues from `docs/design/mockups/connection-detail.html`.

- [ ] **Step 1: `web/src/views/Integrations.tsx`** — list → detail with per-action Test:
```tsx
import { useEffect, useState } from "react";
import { api, type IntegrationView } from "../api";
export function Integrations() {
  const [list, setList] = useState<IntegrationView[]>([]);
  const [open, setOpen] = useState<IntegrationView | null>(null);
  const [result, setResult] = useState<string>("");
  useEffect(() => { api.integrations().then(setList).catch(() => setList([])); }, []);
  const test = async (action: string) => {
    setResult("…");
    try { setResult(JSON.stringify(await api.testAction(open!.name, action, {}), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };
  if (open) return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <button className="ghost" onClick={() => { setOpen(null); setResult(""); }}>← Integraties</button>
      <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em" }}>{open.name} <span className="chip">{open.type}</span></h2>
      <p style={{ color: "var(--muted)" }}>{open.description}</p>
      <div className="eyebrow" style={{ marginTop: 16 }}>Acties</div>
      {open.actions.map((a) => (
        <div key={a.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{a.name}</span>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{a.method}</span>
          <button className="btn sm" onClick={() => test(a.name)}>Test</button>
        </div>
      ))}
      {result && <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10 }}>{result}</pre>}
      <div className="eyebrow" style={{ marginTop: 16 }}>Vereiste secrets</div>
      {open.requiredSecrets.map((s) => (
        <div key={s.ref} className="card" style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{s.ref}</span>
          <span className="chip" style={s.set ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>{s.set ? "gezet" : "ontbreekt"}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Integraties</div>
      {list.length === 0 && <p style={{ color: "var(--faint)" }}>Nog geen integraties.</p>}
      {list.map((i) => (
        <div key={i.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, cursor: "pointer" }} onClick={() => setOpen(i)}>
          <strong style={{ flex: 1 }}>{i.name} <span className="chip">{i.type}</span></strong>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{i.requiredSecrets.filter((s) => s.set).length}/{i.requiredSecrets.length} secrets</span>
        </div>
      ))}
    </div>
  );
}
```
- [ ] **Step 2: `web/src/views/Secrets.tsx`** — write-only list + add-via-link + delete:
```tsx
import { useEffect, useState } from "react";
import { api } from "../api";
export function Secrets() {
  const [items, setItems] = useState<{ ref: string; requiredBy: string[] }[]>([]);
  const [link, setLink] = useState<string>("");
  const refresh = () => api.secrets().then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  const add = async () => {
    const ref = window.prompt("Naam van het secret (bv. NOTION_TOKEN)")?.trim();
    if (!ref) return;
    const { url } = await api.secretLink(ref); setLink(url);
  };
  const del = async (ref: string) => { await api.deleteSecret(ref); refresh(); };
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="eyebrow" style={{ flex: 1 }}>Secrets <span style={{ color: "var(--faint)", textTransform: "none", letterSpacing: 0 }}>— waardes worden nooit getoond</span></div>
        <button className="btn sm" onClick={add}>Secret toevoegen</button>
      </div>
      {link && <div className="card" style={{ display: "block", margin: "12px 0", borderColor: "rgba(52,211,153,.4)" }}>
        <p style={{ margin: "0 0 6px", color: "var(--muted)", fontSize: 13 }}>Open deze eenmalige link om de waarde in te voeren (10 min geldig):</p>
        <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </div>}
      {items.length === 0 && <p style={{ color: "var(--faint)" }}>Nog geen secrets.</p>}
      {items.map((s) => (
        <div key={s.ref} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{s.ref}</span>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{s.requiredBy.length ? `gebruikt door ${s.requiredBy.join(", ")}` : "ongebruikt"}</span>
          <button className="ghost" onClick={() => del(s.ref)}>Verwijder</button>
        </div>
      ))}
    </div>
  );
}
```
- [ ] **Step 3:** Ensure `app.css` has a `.btn.sm` (smaller button) — the visual spec defines `.sm` height 2.25rem. If absent in `web/src/app.css`, add: `.btn.sm,.ghost.sm{height:2.25rem;padding:0 12px;font-size:13px;}`.
- [ ] **Step 4:** `cd web && npx tsc --noEmit && npm run build` → type-clean + builds. **Step 5: Commit** `git add web/src && git commit -m "feat(dashboard): Integrations (list/detail/test) + Secrets (write-only) views"`

---

## Task 9: Full verify + manual e2e

**Files:** modify `test/dashboard.e2e.manual.md`. Verify the whole increment.

- [ ] **Step 1:** Repo root: `npm test` (all green) + `npx tsc --noEmit` (clean) + `npm run build`. Then `cd web && npx tsc --noEmit && npm run build && cd ..`.
- [ ] **Step 2:** Append an Increment-B section to `test/dashboard.e2e.manual.md`:
```markdown
## Increment B — ops views (manual)

(Build the SPA first; log in as in Increment A. Set a real integration + secret to exercise testing.)

8. Click **Capabilities** → see the derived menu (integrations + recipes). Empty vault → "nog geen…".
9. Add a sample integration: `cp examples/integrations/httpbin/manifest.json $GEODE_WORKSPACE/integrations/httpbin/manifest.json` (mkdir first). Click **Integrations** → `httpbin` listed with "0/1 secrets". Open it → see the `headers` action + required `DEMO_KEY` (ontbreekt).
10. Click **Secrets → Secret toevoegen**, name `DEMO_KEY` → a single-use link appears. Open it in a new tab → the §5.9 auth screen (shows `DEMO_KEY`, no value echoed). Enter a value → "opgeslagen in de broker". Reopen the same link → "verlopen of al gebruikt" (single-use).
11. Back in **Integrations → httpbin**, the secret now shows "gezet". Click **Test** on `headers` → a 200 result with the injected header echoed (proves invoke + server-side injection from the dashboard).
12. Produce an artifact (a `query` that writes to `artifacts/`), then **Artifacts** → see it; **Download** (session-authed) returns the file; **Deel-link** mints a signed public URL that works without auth.
13. Confirm no secret value is ever shown anywhere in the UI.
```
- [ ] **Step 3:** Run the manual e2e once (real model for step 11/12). Fix anything that surfaces.
- [ ] **Step 4: Commit** `git add test/dashboard.e2e.manual.md && git commit -m "docs(dashboard): manual e2e for Increment B"`

---

## Notes for the implementer
- Secrets are **write-only**: there is no route or UI that returns a secret value. The §5.9 link writes into the broker; it never reads.
- The `/auth/s/*` routes carry **no session** (a capability link openable on any device) — their security is the signed, expiring, single-use token. The single-use registry is in-memory (lost on restart; acceptable since links are short-lived).
- Keep exported names exact: `mintSecretLink`/`verifySecretLink`/`SecretLinkClaims`; `listIntegrations`/`getIntegration`/`listSecrets`/`listArtifacts`/`IntegrationView`; `renderAuthScreen`/`renderAuthResult`; `VIEWS`/`View`/`TopBar`.
- Artifact downloads go through the **session-authed** `/api/artifacts/download` (the public `/artifacts/*` route needs the bearer token, which the dashboard user does not have). "Deel-link" is the explicit share action (signed public URL).
- The SPA fallback regex must exclude `/auth/` (Task 5) or the §5.9 page is shadowed by index.html.

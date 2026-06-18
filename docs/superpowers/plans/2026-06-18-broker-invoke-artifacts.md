# Broker + invoke + artifacts (Increment 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add the secret broker (encrypted, server-side injection), the caller-only `invoke` operation, one sample HTTP integration + the manifest format, a secret CLI, and artifacts (store + URL serving) — completing the v1 core.

**Architecture:** `invoke` is server-handled: the kernel loads an integration manifest, fetches the required secret from the broker, injects it into the outbound HTTP call, and returns only the result. Secrets are AES-256-GCM encrypted outside the vault; the agent never touches them. Artifacts are stored in a gitignored `artifacts/` and served at `GET /artifacts/<path>` (bearer by default; opt-in HMAC-signed public URL). See spec `2026-06-17-secret-broker-design.md`.

**Tech Stack:** Existing kernel stack (Node/TS NodeNext ESM, `@modelcontextprotocol/sdk` v1, `express`, `zod`, `vitest`), plus Node's built-in `crypto`. No new deps. Built on `main` (post-Increment-1: tools are `query`/`remember`/`list_capabilities`).

---

## File Structure
| File | Change |
|---|---|
| `src/config.ts` | add `secretsDir`, `artifactsDir`, `baseUrl`, `signKey?` |
| `src/secrets.ts` (create) | `SecretStore` (AES-256-GCM blob) + `loadOrCreateKey` |
| `src/integrations.ts` (create) | manifest types + `loadIntegration` + `resolveTemplate` |
| `src/artifacts.ts` (create) | `ArtifactStore` (save, path-safe resolve, sign/verify public URL) |
| `src/invoke.ts` (create) | the `invoke` operation |
| `src/secretCli.ts` (create) | `secret` CLI (set/list/rm) |
| `src/server.ts` | register `invoke` tool; add `GET /artifacts/*` route (bearer + signed); `makeInvokeHandler` |
| `src/query.ts` | report newly-created `artifacts/` files (path + URL) in the result |
| `src/index.ts` | build secret + artifact stores; wire into invoke/query deps |
| `src/seed.ts` | add `artifacts/` to the vault `.gitignore` on seed |
| `package.json` | add `"secret"` script |
| tests + `test/e2e.manual.md` | per tasks |

---

## Task 1: Config additions
**Files:** `src/config.ts`, `test/config.test.ts`.
- [ ] **Step 1: Extend the test** — `loadConfig` returns `secretsDir` (default `<home>/.geode/secrets`), `artifactsDir` (default `<workspaceRoot>/artifacts`), `baseUrl` (default `http://localhost:<port>`); env overrides `GEODE_SECRETS_DIR`, `GEODE_ARTIFACTS_DIR`, `GEODE_BASE_URL`. Add assertions for defaults + overrides (use a fake env with `GEODE_AUTH_TOKEN`+`GEODE_WORKSPACE`).
- [ ] **Step 2: Run** `npx vitest run test/config.test.ts` → FAIL.
- [ ] **Step 3: Implement** — add to the `Config` interface + `loadConfig`:
```typescript
import { homedir } from "node:os";
import { join } from "node:path";
// ...in Config: secretsDir: string; artifactsDir: string; baseUrl: string;
// ...in loadConfig return:
  secretsDir: env.GEODE_SECRETS_DIR || join(homedir(), ".geode", "secrets"),
  artifactsDir: env.GEODE_ARTIFACTS_DIR || join(required(env, "GEODE_WORKSPACE"), "artifacts"),
  baseUrl: env.GEODE_BASE_URL || `http://localhost:${env.GEODE_PORT ? Number(env.GEODE_PORT) : 8787}`,
```
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add -A && git commit -m "feat: config for secrets/artifacts dirs + base URL"`

## Task 2: Secret broker (`src/secrets.ts`)
**Files:** create `src/secrets.ts`, `test/secrets.test.ts`.
- [ ] **Step 1: Failing test** `test/secrets.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStore, loadOrCreateKey } from "../src/secrets.js";

let dir: string; const key = randomBytes(32);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "geode-sec-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("set/get/list/delete round-trip; persists encrypted", async () => {
  const s = createSecretStore({ dir, key });
  await s.set("NOTION_TOKEN", "secret-abc");
  expect(await s.get("NOTION_TOKEN")).toBe("secret-abc");
  expect(await s.list()).toEqual(["NOTION_TOKEN"]);
  const s2 = createSecretStore({ dir, key });       // reload from disk
  expect(await s2.get("NOTION_TOKEN")).toBe("secret-abc");
  await s2.delete("NOTION_TOKEN");
  expect(await s2.get("NOTION_TOKEN")).toBeNull();
});

test("wrong key fails to decrypt (does not return the value)", async () => {
  const s = createSecretStore({ dir, key }); await s.set("K", "v");
  const bad = createSecretStore({ dir, key: randomBytes(32) });
  await expect(bad.get("K")).rejects.toThrow();
});

test("loadOrCreateKey generates a 32-byte key file (0600) and reuses it", () => {
  const k1 = loadOrCreateKey(dir); const k2 = loadOrCreateKey(dir);
  expect(k1.length).toBe(32); expect(k1.equals(k2)).toBe(true);
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/secrets.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  list(): Promise<string[]>;
  delete(ref: string): Promise<void>;
}

function enc(key: Buffer, plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}
function dec(key: Buffer, blob: Buffer): string {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), data = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export function loadOrCreateKey(dir: string, envKey?: string): Buffer {
  if (envKey) {
    const b = Buffer.from(envKey, envKey.length === 64 ? "hex" : "base64");
    if (b.length !== 32) throw new Error("GEODE_SECRETS_KEY must be 32 bytes (hex or base64)");
    return b;
  }
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "key");
  if (existsSync(path)) return readFileSync(path);
  const k = randomBytes(32);
  writeFileSync(path, k, { mode: 0o600 });
  chmodSync(path, 0o600);
  return k;
}

export function createSecretStore(opts: { dir: string; key: Buffer }): SecretStore {
  mkdirSync(opts.dir, { recursive: true });
  const file = join(opts.dir, "secrets.enc");
  const read = (): Record<string, string> => (existsSync(file) ? JSON.parse(dec(opts.key, readFileSync(file))) : {});
  const write = (m: Record<string, string>) => writeFileSync(file, enc(opts.key, JSON.stringify(m)), { mode: 0o600 });
  return {
    async set(ref, value) { const m = read(); m[ref] = value; write(m); },
    async get(ref) { return read()[ref] ?? null; },
    async list() { return Object.keys(read()); },
    async delete(ref) { const m = read(); delete m[ref]; write(m); },
  };
}
```
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add -A && git commit -m "feat: encrypted secret store (AES-256-GCM) + key management"`

## Task 3: Integration manifest + `resolveTemplate` (`src/integrations.ts`)
**Files:** create `src/integrations.ts`, `test/integrations.test.ts`.
- [ ] **Step 1: Failing test**:
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIntegration, resolveTemplate } from "../src/integrations.js";

test("resolveTemplate substitutes params and secrets", () => {
  expect(resolveTemplate("Bearer ${secrets.K}", { params: {}, secrets: { K: "abc" } })).toBe("Bearer abc");
  expect(resolveTemplate("/u/${params.id}", { params: { id: "7" }, secrets: {} })).toBe("/u/7");
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-int-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("loadIntegration parses a manifest; throws on missing", async () => {
  mkdirSync(join(root, "integrations", "x"), { recursive: true });
  writeFileSync(join(root, "integrations", "x", "manifest.json"), JSON.stringify({ name: "x", type: "connection", description: "d", requires: ["K"], actions: { ping: { method: "GET", url: "https://h/p" } } }));
  const m = await loadIntegration(root, "x");
  expect(m.actions.ping.method).toBe("GET");
  await expect(loadIntegration(root, "nope")).rejects.toThrow();
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/integrations.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface IntegrationAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown; description?: string }
export interface IntegrationManifest { name: string; type: "connection"; description: string; requires: string[]; actions: Record<string, IntegrationAction> }

export async function loadIntegration(root: string, name: string): Promise<IntegrationManifest> {
  const raw = await readFile(join(root, "integrations", name, "manifest.json"), "utf8");
  return JSON.parse(raw) as IntegrationManifest;
}

export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; secrets: Record<string, string> }): string {
  return input.replace(/\$\{(params|secrets)\.([\w-]+)\}/g, (_m, ns: string, k: string) => {
    const v = ns === "params" ? ctx.params[k] : ctx.secrets[k];
    return v === undefined || v === null ? "" : String(v);
  });
}
```
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add -A && git commit -m "feat: integration manifest + template resolver"`

## Task 4: Artifact store (`src/artifacts.ts`)
**Files:** create `src/artifacts.ts`, `test/artifacts.test.ts`.
- [ ] **Step 1: Failing test**:
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/artifacts.js";

let dir: string;
const store = () => createArtifactStore({ dir, baseUrl: "http://h:8787", signKey: Buffer.from("k".repeat(32)) });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "geode-art-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("save writes the file and returns a bearer URL", async () => {
  const s = store();
  const r = await s.save("report.md", Buffer.from("hello"));
  expect(existsSync(join(dir, "report.md"))).toBe(true);
  expect(r.url).toBe("http://h:8787/artifacts/report.md");
});

test("resolve rejects path traversal", () => {
  expect(() => store().resolve("../etc/passwd")).toThrow(/outside/);
});

test("signed public URL verifies; tampered/expired fail", () => {
  const s = store();
  const url = s.mintPublicUrl("report.md", 1000);
  const u = new URL(url);
  expect(s.verifyPublic("report.md", u.searchParams.get("exp")!, u.searchParams.get("sig")!)).toBe(true);
  expect(s.verifyPublic("report.md", u.searchParams.get("exp")!, "bad")).toBe(false);
  expect(s.verifyPublic("report.md", "1", u.searchParams.get("sig")!)).toBe(false); // expired (exp in past)
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/artifacts.ts`:
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export interface ArtifactStore {
  dir: string;
  save(relPath: string, data: Buffer): Promise<{ path: string; url: string }>;
  resolve(relPath: string): string;
  mintPublicUrl(relPath: string, ttlMs?: number): string;
  verifyPublic(relPath: string, exp: string, sig: string): boolean;
}

export function createArtifactStore(opts: { dir: string; baseUrl: string; signKey: Buffer; now?: () => number }): ArtifactStore {
  mkdirSync(opts.dir, { recursive: true });
  const now = opts.now ?? (() => Date.now());
  const resolveSafe = (rel: string): string => {
    const abs = resolve(opts.dir, rel);
    if (abs !== opts.dir && !abs.startsWith(opts.dir + sep)) throw new Error(`artifact path outside store: ${rel}`);
    return abs;
  };
  const sigFor = (rel: string, exp: string) => createHmac("sha256", opts.signKey).update(`${rel}:${exp}`).digest("hex");
  return {
    dir: opts.dir,
    resolve: resolveSafe,
    async save(rel, data) {
      const abs = resolveSafe(rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, data);
      return { path: rel, url: `${opts.baseUrl}/artifacts/${rel}` };
    },
    mintPublicUrl(rel, ttlMs = 3600_000) {
      const exp = String(now() + ttlMs);
      return `${opts.baseUrl}/artifacts/${rel}?exp=${exp}&sig=${sigFor(rel, exp)}`;
    },
    verifyPublic(rel, exp, sig) {
      if (Number(exp) < now()) return false;
      const expected = sigFor(rel, exp);
      const a = Buffer.from(sig), b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
```
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add -A && git commit -m "feat: artifact store (save, path-safe, signed public URLs)"`

## Task 5: `invoke` (`src/invoke.ts`)
**Files:** create `src/invoke.ts`, `test/invoke.test.ts`.
- [ ] **Step 1: Failing test** (mock `fetchFn`):
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/invoke.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-inv-"));
  mkdirSync(join(root, "integrations", "demo"), { recursive: true });
  writeFileSync(join(root, "integrations", "demo", "manifest.json"), JSON.stringify({
    name: "demo", type: "connection", description: "d", requires: ["DEMO_KEY"],
    actions: { get_thing: { method: "GET", url: "https://api/things/${params.id}", headers: { Authorization: "Bearer ${secrets.DEMO_KEY}" } } },
  }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const secrets = (m: Record<string,string>) => ({ get: async (k: string) => m[k] ?? null } as any);

test("injects the secret into the request and returns the response (secret not in result)", async () => {
  let seen: any;
  const fetchFn = (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }) as any;
  const res = await invoke({ root, secrets: secrets({ DEMO_KEY: "sk-xyz" }), fetchFn }, { integration: "demo", action: "get_thing", params: { id: "42" } });
  expect(seen.url).toBe("https://api/things/42");
  expect(seen.init.headers.Authorization).toBe("Bearer sk-xyz");
  expect(res.status).toBe(200);
  expect(JSON.stringify(res)).not.toContain("sk-xyz");
});

test("missing secret → clear error naming the ref", async () => {
  const fetchFn = (async () => new Response("", { status: 200 })) as any;
  await expect(invoke({ root, secrets: secrets({}), fetchFn }, { integration: "demo", action: "get_thing", params: { id: "1" } }))
    .rejects.toThrow(/DEMO_KEY/);
});

test("unknown action → clear error", async () => {
  const fetchFn = (async () => new Response("", { status: 200 })) as any;
  await expect(invoke({ root, secrets: secrets({ DEMO_KEY: "x" }), fetchFn }, { integration: "demo", action: "nope" }))
    .rejects.toThrow(/action/i);
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `src/invoke.ts`:
```typescript
import type { SecretStore } from "./secrets.js";
import { loadIntegration, resolveTemplate } from "./integrations.js";

export interface InvokeArgs { integration: string; action: string; params?: Record<string, unknown>; workspace?: string }
export interface InvokeResult { status: number; body: unknown }

export async function invoke(
  deps: { root: string; secrets: Pick<SecretStore, "get">; fetchFn?: typeof fetch },
  args: InvokeArgs,
): Promise<InvokeResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const manifest = await loadIntegration(deps.root, args.integration).catch(() => { throw new Error(`unknown integration: ${args.integration}`); });
  const action = manifest.actions[args.action];
  if (!action) throw new Error(`unknown action "${args.action}" on integration "${args.integration}"`);
  const secrets: Record<string, string> = {};
  for (const ref of manifest.requires ?? []) {
    const v = await deps.secrets.get(ref);
    if (v === null) throw new Error(`secret "${ref}" is not set — add it with: npm run secret -- set ${ref}`);
    secrets[ref] = v;
  }
  const params = args.params ?? {};
  const ctx = { params, secrets };
  const url = resolveTemplate(action.url, ctx);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(action.headers ?? {})) headers[k] = resolveTemplate(v, ctx);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(action.query ?? {})) q.set(k, resolveTemplate(v, ctx));
  const qs = q.toString();
  const body = action.body === undefined ? undefined : typeof action.body === "string" ? resolveTemplate(action.body, ctx) : JSON.stringify(action.body);
  const resp = await fetchFn(qs ? `${url}?${qs}` : url, { method: action.method, headers, body });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: resp.status, body: parsed };
}
```
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add -A && git commit -m "feat: invoke — server-handled integration call with secret injection"`

## Task 6: Secret CLI (`src/secretCli.ts`)
**Files:** create `src/secretCli.ts`; modify `package.json`.
- [ ] **Step 1: Implement** `src/secretCli.ts` — reads config (`loadConfig`), builds the store (`createSecretStore({ dir: config.secretsDir, key: loadOrCreateKey(config.secretsDir, process.env.GEODE_SECRETS_KEY) })`), then:
  - `set <REF>`: prompt hidden (write the value via stdin with echo off — use `readline` with `output` muted, or read from a hidden prompt) → `store.set(REF, value)` → print `✓ saved`.
  - `list`: print `await store.list()` (names only).
  - `rm <REF>`: `store.delete(REF)` → print `✓ removed`.
  Hidden read (zsh-safe, no `-p`): use Node `readline` with a `mutableStdout` that suppresses output while typing (standard recipe). The value must never be echoed.
- [ ] **Step 2:** `npm pkg set scripts.secret="tsx src/secretCli.ts"`.
- [ ] **Step 3: Manual check** — `GEODE_AUTH_TOKEN=x GEODE_WORKSPACE=$(mktemp -d) npm run secret -- set TEST_KEY` (type a value hidden), then `... npm run secret -- list` shows `TEST_KEY`, then `rm`. No unit test (interactive).
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: secret CLI (set/list/rm, hidden input)"`

## Task 7: Server wiring — `invoke` tool + artifacts route
**Files:** `src/server.ts`, `test/server.test.ts`, `src/query.ts`.
- [ ] **Step 1: Failing tests (server)** — add to `test/server.test.ts`:
```typescript
import { makeInvokeHandler } from "../src/server.js";
test("invoke handler returns status + body", async () => {
  const handler = makeInvokeHandler({ invoke: async () => ({ status: 200, body: { ok: true } }) } as any);
  const res = await handler({ integration: "demo", action: "ping" }, {});
  expect(JSON.parse(res.content[0].text).status).toBe(200);
});
test("invoke handler returns a structured error when invoke throws", async () => {
  const handler = makeInvokeHandler({ invoke: async () => { throw new Error("boom"); } } as any);
  const res = await handler({ integration: "x", action: "y" }, {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("boom");
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `src/server.ts`:
  - `import { invoke, type InvokeArgs } from "./invoke.js"`.
  - `export interface InvokeHandlerDeps { invoke: (args: InvokeArgs) => Promise<{status:number;body:unknown}> }` and `makeInvokeHandler(deps)` returning `async (args, _extra) => { try { const r = await deps.invoke(args); return { content:[{type:"text" as const, text: JSON.stringify(r, null, 2)}], structuredContent: { status: r.status } }; } catch (e) { return { content:[{type:"text" as const, text: \`invoke failed: ${e instanceof Error ? e.message : String(e)}\`}], isError: true }; } }`.
  - In `buildMcpServer`, register tool `invoke` with description *"Run one action of an integration in your Geode vault — you (the caller) execute it; the server injects the secret. First ask `query` for the plan, or read the integration manifest, to know the action + params."* `inputSchema: { integration: z.string(), action: z.string(), params: z.record(z.any()).optional(), workspace: z.string().optional() }`. Wire `makeInvokeHandler({ invoke: (a) => invoke({ root: queryDeps.workspace.root, secrets, fetchFn: undefined }, a) })` — `secrets` comes from a new `buildMcpServer` dependency (extend its signature to also accept `{ secrets, artifacts }`, or take a richer deps object).
  - Add the artifacts HTTP route in `buildHttpApp` (it already has `authToken`): also pass the `artifacts` store. Add `app.get("/artifacts/*", ...)`: compute `relPath` from the wildcard; allow if `checkAuth(req.headers.authorization, authToken)` OR `artifacts.verifyPublic(relPath, req.query.exp, req.query.sig)`; else 401/403; then `res.sendFile(artifacts.resolve(relPath))` (catch traversal → 400, missing → 404).
- [ ] **Step 4: query reports artifacts** — in `src/query.ts`, capture the set of files under `<workspace>/artifacts/` before the run and after; for any new file, include `{ path, url: artifacts.mintBearerUrl?... }` — simplest: include `artifacts: string[]` (relative paths) in `QueryResult`, and let the handler render their bearer URLs (`${baseUrl}/artifacts/<path>`). (Pass an `artifactsList(before,after)` helper; keep it small. If this complicates the run-manager flow, list current `artifacts/` contents post-run instead of diffing.)
- [ ] **Step 5: Run** `npm test` + `npx tsc --noEmit` → green/clean.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: register invoke tool + artifacts route (bearer + signed); query reports artifacts"`

## Task 8: Wire it up (`src/index.ts`, `src/seed.ts`)
**Files:** `src/index.ts`, `src/seed.ts` (+ test if behavior changes).
- [ ] **Step 1:** In `src/index.ts`: build `const secrets = createSecretStore({ dir: config.secretsDir, key: loadOrCreateKey(config.secretsDir, process.env.GEODE_SECRETS_KEY) })`; `const artifacts = createArtifactStore({ dir: config.artifactsDir, baseUrl: config.baseUrl, signKey: loadOrCreateKey(config.secretsDir, process.env.GEODE_SIGN_KEY) })` (reuse the key dir; or a separate sign key). Pass `secrets` + `artifacts` into `buildMcpServer` (and `artifacts` into `buildHttpApp`). Pass `artifacts` into `queryDeps` if query reports artifacts.
- [ ] **Step 2:** In `src/seed.ts` (or a startup step): ensure the vault `.gitignore` contains `artifacts/` (append if missing) so agent-written artifacts aren't committed. Add/adjust the seed test accordingly.
- [ ] **Step 3:** `npx tsc --noEmit` + `npm test` → clean/green. **Step 4: Commit** `git add -A && git commit -m "feat: wire secret + artifact stores into the kernel; gitignore artifacts/"`

## Task 9: Full verify + manual e2e
- [ ] **Step 1:** `npm test && npx tsc --noEmit && npm run build` → all green/clean.
- [ ] **Step 2:** Update `test/e2e.manual.md`: set a secret via `npm run secret -- set DEMO_KEY`; add `integrations/httpbin/manifest.json` (a GET to `https://httpbin.org/headers` injecting `X-Demo: Bearer ${secrets.DEMO_KEY}`); `invoke` it → the echoed headers show the injected value (proving injection) and our `InvokeResult` doesn't leak the secret beyond the API's own echo; `query("how do I call the httpbin integration?")` → returns the `invoke(...)` plan; write an artifact + download it via its bearer URL and a minted public URL.
- [ ] **Step 3: Commit** the e2e doc.

## Notes for the implementer
- Secrets/artifacts dirs live OUTSIDE git (secrets) / gitignored (artifacts) — never commit secret values or artifacts.
- The agent never calls `invoke` and never reads secrets — `invoke` is caller-only + server-handled.
- Keep exported names exact (`createSecretStore`, `loadOrCreateKey`, `loadIntegration`, `resolveTemplate`, `createArtifactStore`, `invoke`, `makeInvokeHandler`).
- `buildMcpServer`/`buildHttpApp` signatures grow (secrets + artifacts) — update `index.ts` + the existing server tests' call sites accordingly.

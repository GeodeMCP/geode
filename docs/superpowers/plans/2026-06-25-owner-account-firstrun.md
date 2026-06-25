# Owner Account & First-Run Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the env-only dashboard password with a hashed **single-owner account** created in the browser on first run, while keeping the auth layer abstract enough to grow into multi-user later, and migrating the current env-password deployment seamlessly.

**Architecture:** A machine-local `AccountStore` (scrypt-hashed owner record) behind an interface that a future multi-account store can replace. Sessions carry a `sub` (principal id). The dashboard resolves one of three states (setup / account-login / env-password-login) via `GET /api/auth-info`. Login/setup are rate-limited. Ships **before** sub-project B (OAuth), which will reuse the owner identity.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffix), Express 5, Node `crypto` (scrypt — no new dep), vitest; React 18 + Vite, `@testing-library/react`.

**Reference:** spec `docs/superpowers/specs/2026-06-25-owner-account-firstrun-design.md`.

---

### Task 1: AccountStore (`src/account.ts`)

**Files:** Create `src/account.ts`; Test `test/account.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/account.test.ts`:
```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountStore } from "../src/account.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "geode-acct-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("no owner initially; createOwner then verify round-trips; persists across instances", () => {
  const s = createAccountStore(dir);
  expect(s.hasOwner()).toBe(false);
  const p = s.createOwner({ email: "me@example.com", password: "correct-horse" });
  expect(p.email).toBe("me@example.com");
  expect(p.id).toMatch(/[0-9a-f-]{36}/);
  expect(s.hasOwner()).toBe(true);
  expect(s.verify("me@example.com", "correct-horse")?.id).toBe(p.id);
  expect(s.verify("me@example.com", "wrong")).toBeNull();
  expect(s.verify("other@example.com", "correct-horse")).toBeNull();
  // a fresh instance reads the persisted record
  expect(createAccountStore(dir).getOwner()?.email).toBe("me@example.com");
});

test("rejects a second owner, weak passwords, and bad emails", () => {
  const s = createAccountStore(dir);
  s.createOwner({ email: "me@example.com", password: "correct-horse" });
  expect(() => s.createOwner({ email: "x@y.com", password: "abcdefghij" })).toThrow(/already exists/);
  const s2 = createAccountStore(mkdtempSync(join(tmpdir(), "geode-acct2-")));
  expect(() => s2.createOwner({ email: "me@example.com", password: "short" })).toThrow(/at least/);
  expect(() => s2.createOwner({ email: "not-an-email", password: "abcdefghij" })).toThrow(/email/);
});

test("setPassword changes the stored hash", () => {
  const s = createAccountStore(dir);
  s.createOwner({ email: "me@example.com", password: "correct-horse" });
  s.setPassword("me@example.com", "new-passphrase");
  expect(s.verify("me@example.com", "correct-horse")).toBeNull();
  expect(s.verify("me@example.com", "new-passphrase")).not.toBeNull();
});
```

- [ ] **Step 2: Run it — confirm it fails** — `npx vitest run test/account.test.ts` → cannot find `../src/account.js`.

- [ ] **Step 3: Implement `src/account.ts`:**
```ts
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Principal { id: string; email: string; createdAt: number }
interface OwnerRecord { id: string; email: string; salt: string; hash: string; createdAt: number }

export interface AccountStore {
  hasOwner(): boolean;
  getOwner(): Principal | null;
  createOwner(args: { email: string; password: string }): Principal;
  verify(email: string, password: string): Principal | null;
  setPassword(email: string, password: string): void;
}

const MIN_PASSWORD = 10;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const hashPw = (password: string, salt: Buffer): Buffer => scryptSync(password, salt, 32);

// Single-owner account, machine-local (one record). The interface is deliberately store-shaped so a
// future multi-account/DB implementation drops in without changing callers.
export function createAccountStore(dir: string): AccountStore {
  const file = join(dir, "account.json");
  const read = (): OwnerRecord | null => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as OwnerRecord) : null);
  const write = (rec: OwnerRecord) => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(rec, null, 2), { mode: 0o600 }); };
  const toPrincipal = (r: OwnerRecord): Principal => ({ id: r.id, email: r.email, createdAt: r.createdAt });
  const recordFor = (email: string, password: string, base?: OwnerRecord): OwnerRecord => {
    if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    const salt = randomBytes(16);
    return { id: base?.id ?? randomUUID(), email, salt: salt.toString("hex"), hash: hashPw(password, salt).toString("hex"), createdAt: base?.createdAt ?? Date.now() };
  };
  return {
    hasOwner: () => read() !== null,
    getOwner: () => { const r = read(); return r ? toPrincipal(r) : null; },
    createOwner({ email, password }) {
      if (read()) throw new Error("owner already exists");
      if (!EMAIL_RE.test(email)) throw new Error("invalid email");
      const rec = recordFor(email, password);
      write(rec);
      return toPrincipal(rec);
    },
    verify(email, password) {
      const r = read();
      if (!r || r.email !== email) return null;
      const expected = Buffer.from(r.hash, "hex");
      const got = hashPw(password, Buffer.from(r.salt, "hex"));
      return got.length === expected.length && timingSafeEqual(got, expected) ? toPrincipal(r) : null;
    },
    setPassword(email, password) {
      const r = read();
      if (!r || r.email !== email) throw new Error("no such owner");
      write(recordFor(email, password, r));
    },
  };
}
```

- [ ] **Step 4: Run — confirm PASS** — `npx vitest run test/account.test.ts`.
- [ ] **Step 5: Commit** — `git add src/account.ts test/account.test.ts && git commit -m "feat(account): scrypt-hashed single-owner AccountStore"`

---

### Task 2: Rate limiter (`src/dashboard/rateLimit.ts`)

**Files:** Create `src/dashboard/rateLimit.ts`; Test `test/dashboard/rateLimit.test.ts`.

- [ ] **Step 1: Write the failing test:**
```ts
import { expect, test } from "vitest";
import { createRateLimiter } from "../../src/dashboard/rateLimit.js";

test("allows up to the limit, then trips, then recovers after the window", () => {
  let t = 1000;
  const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  expect([rl.check("ip").ok, rl.check("ip").ok, rl.check("ip").ok]).toEqual([true, true, true]);
  const tripped = rl.check("ip");
  expect(tripped.ok).toBe(false);
  expect(tripped.retryAfter).toBeGreaterThan(0);
  expect(rl.check("other").ok).toBe(true);   // independent key
  t += 1000;                                  // window elapsed
  expect(rl.check("ip").ok).toBe(true);
});
```

- [ ] **Step 2: Run — confirm fail.** `npx vitest run test/dashboard/rateLimit.test.ts`

- [ ] **Step 3: Implement `src/dashboard/rateLimit.ts`:**
```ts
export interface RateLimiter { check(key: string): { ok: boolean; retryAfter: number } }

// Fixed-window in-memory limiter: at most `limit` calls per `windowMs` per key.
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const hits = new Map<string, { count: number; start: number }>();
  return {
    check(key) {
      const t = now();
      const e = hits.get(key);
      if (!e || t - e.start >= opts.windowMs) { hits.set(key, { count: 1, start: t }); return { ok: true, retryAfter: 0 }; }
      e.count++;
      if (e.count > opts.limit) return { ok: false, retryAfter: Math.ceil((e.start + opts.windowMs - t) / 1000) };
      return { ok: true, retryAfter: 0 };
    },
  };
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** — `git add src/dashboard/rateLimit.ts test/dashboard/rateLimit.test.ts && git commit -m "feat(dashboard): in-memory rate limiter"`

---

### Task 3: Sessions carry a subject (`sub`)

**Files:** Modify `src/dashboard/session.ts`, `test/dashboard/session.test.ts`, and the one caller in `src/dashboard/api.ts`.

- [ ] **Step 1: Update the test** — replace the round-trip test in `test/dashboard/session.test.ts`:
```ts
test("signSession carries the subject and verifies; tampered/expired fail", () => {
  const now = 1_000_000;
  const tok = signSession(key, 60_000, "owner-1", () => now);
  expect(verifySession(key, tok, () => now)).toEqual({ sub: "owner-1" });
  expect(verifySession(key, tok + "x", () => now)).toBeNull();
  expect(verifySession(key, tok, () => now + 61_000)).toBeNull();
});

test("sessionFromCookie reads + verifies a cookie header", () => {
  const tok = signSession(key, 60_000, "owner-1");
  expect(sessionFromCookie(key, `a=1; geode_session=${tok}; b=2`)?.sub).toBe("owner-1");
  expect(sessionFromCookie(key, undefined)).toBeNull();
});
```
Add `signSession, verifySession, parseCookie, sessionFromCookie` to the existing import line.

- [ ] **Step 2: Run — confirm fail** (`sub` not yet supported / `sessionFromCookie` missing). `npx vitest run test/dashboard/session.test.ts`

- [ ] **Step 3: Implement in `src/dashboard/session.ts`** — replace `signSession`, `verifySession`, `requireSession`, and add `sessionFromCookie` (the `sub` MUST be dot-free; principal ids are UUIDs / `env-owner`):
```ts
/** Token = "<exp>.<sub>.<sig>" where sig = HMAC(key, "<exp>.<sub>"). exp is ms-since-epoch; sub is dot-free. */
export function signSession(key: Buffer, ttlMs: number, sub: string, now: () => number = Date.now): string {
  const payload = `${now() + ttlMs}.${sub}`;
  return `${payload}.${sign(key, payload)}`;
}

export function verifySession(key: Buffer, token: string, now: () => number = Date.now): { sub: string } | null {
  const i = token.indexOf("."); if (i < 0) return null;
  const j = token.indexOf(".", i + 1); if (j < 0) return null;
  const exp = token.slice(0, i), sub = token.slice(i + 1, j), sig = token.slice(j + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now()) return null;
  const expected = sign(key, `${exp}.${sub}`);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { sub } : null;
}

export function sessionFromCookie(key: Buffer, cookieHeader: string | undefined, now: () => number = Date.now): { sub: string } | null {
  const tok = parseCookie(cookieHeader, COOKIE);
  return tok ? verifySession(key, tok, now) : null;
}

/** Express middleware: 401 unless a valid session cookie is present; attaches the principal to res.locals. */
export function requireSession(key: Buffer) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = sessionFromCookie(key, req.headers.cookie);
    if (s) { (res.locals as Record<string, unknown>).principal = s; return next(); }
    res.status(401).json({ error: "unauthorized" });
  };
}
```

- [ ] **Step 4: Fix the single caller** in `src/dashboard/api.ts` so the suite compiles — the existing `/login` handler calls `signSession(deps.sessionKey, SESSION_TTL)`; change it to `signSession(deps.sessionKey, SESSION_TTL, "env-owner")` (this whole handler is reworked in Task 4).

- [ ] **Step 5: Run — PASS** — `npx vitest run test/dashboard` (session + all dashboard route tests stay green; cookies still validate).
- [ ] **Step 6: Commit** — `git add src/dashboard/session.ts test/dashboard/session.test.ts src/dashboard/api.ts && git commit -m "feat(session): carry a subject (sub) in the session token"`

---

### Task 4: Config + wiring + auth-info / setup / login endpoints

**Files:** Modify `src/config.ts`, `src/index.ts`, `src/dashboard/api.ts`, and the three ApiDeps test setups (`test/dashboard/api.test.ts`, `api-ops.test.ts`, `authRoute.test.ts`); extend `test/config.test.ts` and `test/dashboard/api.test.ts`.

- [ ] **Step 1: Write the failing tests** — add to `test/dashboard/api.test.ts`. First, in `boot()`, add `accounts: createAccountStore(join(root, ".accounts")),` to the `createApiRouter({ ... })` deps and import `createAccountStore` from `"../../src/account.js"`. Then add:
```ts
test("auth-info reports env-password mode before an owner exists", async () => {
  const info = await (await fetch(`${url}/api/auth-info`)).json();
  expect(info).toMatchObject({ mode: "login", method: "password", authed: false });
});

test("setup is forbidden on an env-protected kernel without a session, allowed with one, then login uses the account", async () => {
  // no session → forbidden
  const noSess = await fetch(`${url}/api/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "correct-horse" }) });
  expect(noSess.status).toBe(403);
  // log in via env, then claim the owner
  const cookie = await login();
  const ok = await fetch(`${url}/api/setup`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "correct-horse" }) });
  expect((await ok.json()).ok).toBe(true);
  const info = await (await fetch(`${url}/api/auth-info`)).json();
  expect(info).toMatchObject({ mode: "login", method: "account" });
  // account login now works with email + password; wrong password fails
  const good = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "correct-horse" }) });
  expect(good.status).toBe(200);
  const bad = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "nope" }) });
  expect(bad.status).toBe(401);
});

test("login is rate-limited after repeated failures", async () => {
  let last = 200;
  for (let i = 0; i < 12; i++) {
    last = (await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) })).status;
  }
  expect(last).toBe(429);
});
```
Add `accounts: createAccountStore(...)` to the `boot()` of `test/dashboard/api-ops.test.ts` and the `mountDashboard` deps of `test/dashboard/authRoute.test.ts` (import `createAccountStore`, use a temp `.accounts` dir under each test's `root`). Extend `test/config.test.ts`: `expect(loadConfig(base).accountDir).toMatch(/\/.geode$/)` and an override `GEODE_ACCOUNT_DIR`.

- [ ] **Step 2: Run — confirm fail.** `npx vitest run test/dashboard/api.test.ts test/config.test.ts`

- [ ] **Step 3: `src/config.ts`** — add `accountDir: string` to `Config`, and in `loadConfig`: `accountDir: env.GEODE_ACCOUNT_DIR || join(homedir(), ".geode"),`.

- [ ] **Step 4: `src/dashboard/api.ts`** — wire it up:
  - Imports: `import type { AccountStore } from "../account.js";`, `import { createRateLimiter } from "./rateLimit.js";`, and add `sessionFromCookie` to the `./session.js` import.
  - `ApiDeps` gains `accounts: AccountStore;`.
  - At the top of `createApiRouter`: `const loginLimiter = createRateLimiter({ limit: 8, windowMs: 60_000 });` and `const ipKey = (req: Request) => (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress || "unknown";`
  - Replace the existing public `/login` + `/logout` block with:
```ts
  router.get("/auth-info", (req, res) => {
    const hasOwner = deps.accounts.hasOwner();
    res.json({
      mode: hasOwner || deps.dashboardPassword ? "login" : "setup",
      method: hasOwner ? "account" : "password",
      authed: !!sessionFromCookie(deps.sessionKey, req.headers.cookie),
    });
  });

  router.post("/setup", (req, res) => {
    if (deps.accounts.hasOwner()) { res.status(409).json({ error: "owner already exists" }); return; }
    // On an env-protected (possibly public) kernel, only a logged-in operator may claim the owner.
    if (deps.dashboardPassword && !sessionFromCookie(deps.sessionKey, req.headers.cookie)) { res.status(403).json({ error: "log in first" }); return; }
    const lim = loginLimiter.check(ipKey(req)); if (!lim.ok) { res.status(429).json({ error: "too many attempts", retryAfter: lim.retryAfter }); return; }
    try {
      const p = deps.accounts.createOwner({ email: String(req.body?.email ?? ""), password: String(req.body?.password ?? "") });
      setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, p.id), deps.secure);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  router.post("/login", (req, res) => {
    const lim = loginLimiter.check(ipKey(req)); if (!lim.ok) { res.status(429).json({ error: "too many attempts", retryAfter: lim.retryAfter }); return; }
    const password = String(req.body?.password ?? "");
    if (deps.accounts.hasOwner()) {
      const p = deps.accounts.verify(String(req.body?.email ?? ""), password);
      if (!p) { res.status(401).json({ error: "invalid credentials" }); return; }
      setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, p.id), deps.secure);
      res.json({ ok: true }); return;
    }
    if (deps.dashboardPassword) {
      const a = Buffer.from(password), b = Buffer.from(deps.dashboardPassword);
      if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: "invalid password" }); return; }
      setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, "env-owner"), deps.secure);
      res.json({ ok: true }); return;
    }
    res.status(403).json({ error: "no owner configured; complete setup" });
  });
  router.post("/logout", (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
```
  (Keep the existing `signSession`, `setSessionCookie`, `clearSessionCookie`, `timingSafeEqual` imports.)

- [ ] **Step 5: `src/index.ts`** — `import { createAccountStore } from "./account.js";`, `const accounts = createAccountStore(config.accountDir);`, and add `accounts,` to the `mountDashboard(app, { ... })` deps.

- [ ] **Step 6: Run — PASS** — `npx vitest run test/dashboard test/config.test.ts` then `npx tsc --noEmit`.
- [ ] **Step 7: Commit** — `git add src/config.ts src/index.ts src/dashboard/api.ts test/dashboard/*.test.ts test/config.test.ts && git commit -m "feat(api): auth-info, in-browser setup, account/env login (rate-limited)"`

---

### Task 5: Web — Setup screen, mode-aware Login, routing

**Files:** Modify `web/src/api.ts`, `web/src/views/Login.tsx`, `web/src/App.tsx`; Create `web/src/views/Setup.tsx`, `web/src/views/Setup.test.tsx`.

- [ ] **Step 1: `web/src/api.ts`** — add the type + methods, and give `login` an optional email:
```ts
export interface AuthInfo { mode: "setup" | "login"; method: "account" | "password"; authed: boolean }
```
```ts
  authInfo: () => json<AuthInfo>("/api/auth-info"),
  setup: (email: string, password: string) => json<{ ok: true }>("/api/setup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (password: string, email?: string) => json<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password, email }) }),
```
(Replace the existing `login:` line.)

- [ ] **Step 2: Write the failing test** — `web/src/views/Setup.test.tsx`:
```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../api", () => ({ api: { setup: vi.fn().mockResolvedValue({ ok: true }) } }));
import { api } from "../api";
import { Setup } from "./Setup";
afterEach(cleanup);

test("submits email + password and calls onIn on success", async () => {
  let entered = false;
  render(<Setup onIn={() => (entered = true)} />);
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: "me@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "correct-horse" } });
  fireEvent.change(screen.getByPlaceholderText(/confirm/i), { target: { value: "correct-horse" } });
  fireEvent.click(screen.getByRole("button"));
  await vi.waitFor(() => expect((api.setup as any)).toHaveBeenCalledWith("me@example.com", "correct-horse"));
  await vi.waitFor(() => expect(entered).toBe(true));
});

test("blocks mismatched passwords without calling setup", () => {
  render(<Setup onIn={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: "me@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "correct-horse" } });
  fireEvent.change(screen.getByPlaceholderText(/confirm/i), { target: { value: "different-one" } });
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(/match/i)).toBeTruthy();
});
```

- [ ] **Step 3: Run — confirm fail.** `cd web && npx vitest run src/views/Setup.test.tsx && cd ..`

- [ ] **Step 4: Create `web/src/views/Setup.tsx`** (reuses the `.auth` styles from `Login.tsx`):
```tsx
import { useState } from "react";
import { api } from "../api";
import { GemMark } from "../components/Logo";

export function Setup({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) { setErr("Passwords don't match"); return; }
    if (pw.length < 10) { setErr("Use at least 10 characters"); return; }
    try { await api.setup(email, pw); onIn(); } catch (e) { setErr(e instanceof Error ? e.message : "Setup failed"); }
  };
  return (
    <div className="auth">
      <div className="glow" />
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><GemMark size={22} /><span className="name">Geode</span></div>
        <span className="eyebrow" style={{ padding: 0 }}>First run</span>
        <h2>Create your vault</h2>
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 10 }} />
        <input className="input" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ marginTop: 10 }} />
        {err && <p style={{ color: "#eaa", fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>Create vault</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Rework `web/src/views/Login.tsx`** to take a `method` prop and show the email field only in account mode:
```tsx
import { useState } from "react";
import { api } from "../api";
import { GemMark } from "../components/Logo";

export function Login({ method, onIn }: { method: "account" | "password"; onIn: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.login(pw, method === "account" ? email : undefined); onIn(); } catch { setErr("Wrong credentials"); }
  };
  return (
    <div className="auth">
      <div className="glow" />
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><GemMark size={22} /><span className="name">Geode</span></div>
        <span className="eyebrow" style={{ padding: 0 }}>Dashboard</span>
        <h2>Sign in</h2>
        {method === "account" && <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus style={{ marginBottom: 10 }} />}
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={method === "password"} />
        {err && <p style={{ color: "#eaa", fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>Sign in</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Rework `web/src/App.tsx`** to route on `auth-info`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type AuthInfo } from "./api";
import { Login } from "./views/Login";
import { Setup } from "./views/Setup";
import { TopBar, type View } from "./components/TopBar";
import { VaultHome } from "./views/VaultHome";
import { Capabilities } from "./views/Capabilities";
import { Integrations } from "./views/Integrations";
import { Secrets } from "./views/Secrets";
import { Artifacts } from "./views/Artifacts";

export function App() {
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [view, setView] = useState<View>("Vault");
  const [hasTools, setHasTools] = useState(false);
  const refresh = useCallback(() => api.authInfo().then(setAuth).catch(() => setAuth({ mode: "login", method: "password", authed: false })), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (auth?.authed) api.integrations().then((l) => setHasTools(l.length > 0)).catch(() => {}); }, [auth?.authed]);
  const logout = async () => { await api.logout().catch(() => {}); setHasTools(false); setView("Vault"); refresh(); };
  if (!auth) return null;
  if (!auth.authed) return auth.mode === "setup"
    ? <Setup onIn={refresh} />
    : <Login method={auth.method} onIn={refresh} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar view={view} onNav={setView} hasTools={hasTools} onLogout={logout} />
      {view === "Vault" && <VaultHome />}
      {view === "Capabilities" && <Capabilities />}
      {view === "Connect" && <Connect />}
      {view === "Integrations" && <Integrations />}
      {view === "Secrets" && <Secrets />}
      {view === "Artifacts" && <Artifacts />}
    </div>
  );
}
```
  Keep the existing `Connect` import (added in sub-project A) — re-add `import { Connect } from "./views/Connect";` with the others.

- [ ] **Step 7: Run web tests + typecheck + build** — `cd web && npx vitest run && npx tsc -b --noEmit && npm run build && cd ..` (all green: existing + Setup test).
- [ ] **Step 8: Commit** — `git add web/src/api.ts web/src/views/Setup.tsx web/src/views/Setup.test.tsx web/src/views/Login.tsx web/src/App.tsx && git commit -m "feat(web): first-run Setup, mode-aware Login, auth-info routing"`

---

### Task 6: Owner CLI (`src/ownerCli.ts`)

**Files:** Create `src/ownerCli.ts`; Modify `package.json`.

- [ ] **Step 1: Create `src/ownerCli.ts`** (mirrors `src/secretCli.ts`'s hidden-prompt pattern):
```ts
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createAccountStore } from "./account.js";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc as BufferEncoding); cb(); } });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    muted = true;
  });
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const config = loadConfig(process.env);
  const store = createAccountStore(config.accountDir);
  switch (cmd) {
    case "show":
      console.log(store.getOwner()?.email ?? "(no owner — first-run setup pending)");
      break;
    case "create": {
      if (!arg) throw new Error("usage: owner create <email>");
      const pw = await promptHidden(`Password for ${arg}: `);
      store.createOwner({ email: arg, password: pw });
      console.log(`created owner ${arg}`);
      break;
    }
    case "set-password": {
      const owner = store.getOwner();
      if (!owner) throw new Error("no owner yet — use: owner create <email>");
      const pw = await promptHidden(`New password for ${owner.email}: `);
      store.setPassword(owner.email, pw);
      console.log(`updated password for ${owner.email}`);
      break;
    }
    case "reset": {
      const file = join(config.accountDir, "account.json");
      if (existsSync(file)) rmSync(file);
      console.log("owner reset — first-run setup will run again");
      break;
    }
    default:
      console.log("usage: owner <show|create <email>|set-password|reset>");
      process.exit(1);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
```

- [ ] **Step 2: `package.json`** — add to `scripts`: `"owner": "tsx src/ownerCli.ts"`.
- [ ] **Step 3: Smoke it** — `GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=/tmp/x GEODE_ACCOUNT_DIR=$(mktemp -d) npm run owner -- show` prints the no-owner message.
- [ ] **Step 4: Commit** — `git add src/ownerCli.ts package.json && git commit -m "feat(cli): owner show/create/set-password/reset"`

---

### Task 7: Docs + live validation

**Files:** Modify `README.md`, `test/dashboard.e2e.manual.md`.

- [ ] **Step 1: README** — document first-run: if `GEODE_DASHBOARD_PASSWORD` is unset and no owner exists, the dashboard shows a one-time "Create your vault" screen (email + password, scrypt-hashed at `~/.geode/account.json`); if the env password is set it remains a valid login and a logged-in operator can upgrade via setup; `npm run owner -- reset|create <email>|set-password|show` for recovery. Note the public-exposure warning (strong password; the static `GEODE_AUTH_TOKEN` becomes internet-reachable when public).

- [ ] **Step 2: Manual E2E** — append to `test/dashboard.e2e.manual.md`:
```markdown

## Owner account & first-run (manual)

22. Fresh vault, no `GEODE_DASHBOARD_PASSWORD` → open `/` → "Create your vault" (email + password). Submit → logged in. Restart → email+password login works; wrong password trips a 429 after ~8 tries.
23. Env-fallback: set `GEODE_DASHBOARD_PASSWORD`, delete `~/.geode/account.json` → login is password-only (as before). While logged in, run setup (email + password) → an account is created and supersedes the env password on next login.
24. `npm run owner -- show` prints the owner email; `npm run owner -- reset` returns to first-run.
```

- [ ] **Step 3: Live validation** — `cd web && npm run build && cd ..`; run the kernel against a fresh `GEODE_WORKSPACE` and a fresh `GEODE_ACCOUNT_DIR` with **no** `GEODE_DASHBOARD_PASSWORD`; confirm the "Create your vault" flow, restart-login, rate-limit, and the env-fallback + upgrade path. Confirm the current demo (env `pw`, no account file) still logs in unchanged.
- [ ] **Step 4: Commit** — `git add README.md test/dashboard.e2e.manual.md && git commit -m "docs: first-run owner account + manual E2E steps"`

---

## Self-review notes

- **Spec coverage:** AccountStore + Principal (Task 1); rate-limiting (Task 2, wired Task 4); session `sub` (Task 3); accountDir + auth-info/setup/login + env fallback + claim-when-authed guard (Task 4); Setup screen + mode-aware Login + routing (Task 5); owner CLI (Task 6); docs + migration validation (Task 7). ✔
- **Multi-user seams built now:** `Principal`/`AccountStore` interface; sessions carry `sub`; `requireSession` attaches the principal to `res.locals`. Per-principal workspace routing is **not** built (deferred to #6) — the `sub` seam keeps it additive.
- **Type consistency:** `ApiDeps.accounts: AccountStore` added and threaded from `index.ts`; the three ApiDeps test setups updated so the suite compiles (mirrors how sub-project A added `authToken`). `signSession` gains a required `sub`; the only caller (`/login`) is updated in Task 3 then finalized in Task 4. `AuthInfo` defined once in `web/src/api.ts`.
- **Deferred:** multi-account/roles, per-principal workspaces (#6), email verification + reset-via-email, SSO, the AGPL+commercial licensing/trademark work.

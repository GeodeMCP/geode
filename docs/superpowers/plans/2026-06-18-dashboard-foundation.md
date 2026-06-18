# Dashboard Increment A (Foundation + Vault home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kernel-served, authenticated web dashboard whose Vault home lets you talk to the vault agent and review/commit its knowledge edits from the browser.

**Architecture:** The existing Express app (kernel) gains a dashboard module: it serves a built React+Vite SPA, a thin first-party `/api` layer (JSON), and streams agent progress over SSE. Agent runs invoked from the dashboard use a new **review mode** (`commit: false`) so changes land uncommitted; the human reviews the diff and clicks Commit/Verwerp. The dashboard calls the existing kernel functions directly (`query`, `remember`, `workspace`) — not over MCP. Login is a configured password → signed httpOnly session cookie.

**Tech Stack:** Existing kernel stack (Node/TS NodeNext ESM, `express` v5, `vitest`, Node `crypto`) + React 18 + Vite 5 + TypeScript for the SPA. Visual base: `docs/design/app.css` + `docs/design/mockups/dashboard-home-with-nav.html`. No new backend deps (cookies parsed manually; SSE is plain `res.write`).

Spec: `docs/superpowers/specs/2026-06-18-dashboard-design.md` (Increment A = §11).

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/config.ts` (modify) | add `dashboardPassword?: string` (dashboard enabled iff set) |
| `src/workspace.ts` (modify) | add `uncommittedChanges()`, `diff(relPath)`, `fileContent(relPath)` |
| `src/query.ts` (modify) | add `opts?: { commit?: boolean }` — review mode skips auto-commit + event log; touched files from the working tree |
| `src/ingest.ts` (modify) | thread `opts` through `remember` |
| `src/dashboard/session.ts` (create) | sign/verify session token (HMAC-SHA256); cookie read/write; `requireSession` middleware |
| `src/dashboard/knowledge.ts` (create) | knowledge tree (excludes `integrations/`, `artifacts/`, `.git`), path-safe `readFile`, `gitDiff`, `parseStatus` |
| `src/dashboard/sse.ts` (create) | `openSse(res)` helper → `{ send(event,data), close() }` |
| `src/dashboard/api.ts` (create) | the `/api` Express router (login/logout, query/remember SSE, tree/file/diff/status/commit/discard) |
| `src/dashboard/index.ts` (create) | `mountDashboard(app, deps)` — session middleware + `/api` router + static SPA serving |
| `src/index.ts` (modify) | call `mountDashboard` when `config.dashboardPassword` is set; build the session secret |
| `web/` (create) | Vite React SPA (login + 3-pane Vault home); built to `web/dist`, served by the kernel |
| `test/dashboard/*.test.ts` (create) | session, knowledge, sse, review-mode query, api logic |
| `test/dashboard.e2e.manual.md` (create) | manual end-to-end checklist |

Conventions to follow (already in the repo): NodeNext ESM with `.js` import suffixes on `.ts` sources; tests in `test/` using `vitest`; temp dirs via `mkdtempSync`; handlers factored so logic is unit-testable (see `src/server.ts`).

---

## Task 1: Config — dashboard password

**Files:** Modify `src/config.ts`; Test `test/config.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `test/config.test.ts`:

```typescript
test("dashboardPassword is read from env and is undefined by default", () => {
  const base = { GEODE_AUTH_TOKEN: "t", GEODE_WORKSPACE: "/tmp/x" };
  expect(loadConfig({ ...base }).dashboardPassword).toBeUndefined();
  expect(loadConfig({ ...base, GEODE_DASHBOARD_PASSWORD: "hunter2" }).dashboardPassword).toBe("hunter2");
});
```

- [ ] **Step 2: Run** `npx vitest run test/config.test.ts` → FAIL (`dashboardPassword` missing).

- [ ] **Step 3: Implement** — in `src/config.ts` add to the `Config` interface: `dashboardPassword?: string;` and to the `loadConfig` return object:

```typescript
    dashboardPassword: env.GEODE_DASHBOARD_PASSWORD || undefined,
```

- [ ] **Step 4: Run** `npx vitest run test/config.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(dashboard): config GEODE_DASHBOARD_PASSWORD"
```

---

## Task 2: Workspace — read, diff, uncommitted changes

**Files:** Modify `src/workspace.ts`; Test `test/workspace.dashboard.test.ts` (create).

- [ ] **Step 1: Write the failing test** — create `test/workspace.dashboard.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../src/workspace.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-ws-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("uncommittedChanges lists working-tree changes; fileContent + diff reflect edits", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\noriginal\n");
  await ws.commitAll("seed");
  // edit + add a new file (uncommitted)
  writeFileSync(join(root, "index.md"), "# Index\nedited\n");
  writeFileSync(join(root, "note.md"), "new\n");
  const changes = await ws.uncommittedChanges();
  expect(changes.sort()).toEqual(["index.md", "note.md"]);
  expect(await ws.fileContent("index.md")).toContain("edited");
  expect(await ws.diff("index.md")).toContain("+# Index");
  expect(await ws.statusPorcelain()).toContain("index.md");
});

test("fileContent rejects path traversal", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  await expect(ws.fileContent("../secret")).rejects.toThrow(/outside/);
});
```

- [ ] **Step 2: Run** `npx vitest run test/workspace.dashboard.test.ts` → FAIL (methods missing).

- [ ] **Step 3: Implement** — in `src/workspace.ts` add to the `Workspace` interface:

```typescript
  uncommittedChanges(): Promise<string[]>;
  fileContent(relPath: string): Promise<string>;
  diff(relPath: string): Promise<string>;
  statusPorcelain(): Promise<string>;
```

Add these imports at the top (keep the existing `runGit` import):

```typescript
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
```

Add to the object returned by `createWorkspace` (a `safeResolve` closure + three methods):

```typescript
    async uncommittedChanges() {
      const out = await runGit(root, ["status", "--porcelain"]);
      if (!out) return [];
      // porcelain line: "XY <path>" (rename shows "old -> new"; take the new path)
      return out.split("\n").map((l) => {
        const p = l.slice(3);
        const arrow = p.indexOf(" -> ");
        return arrow >= 0 ? p.slice(arrow + 4) : p;
      });
    },
    async fileContent(relPath) {
      const abs = resolve(root, relPath);
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path outside workspace: ${relPath}`);
      return readFile(abs, "utf8");
    },
    async diff(relPath) {
      const abs = resolve(root, relPath);
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path outside workspace: ${relPath}`);
      return runGit(root, ["diff", "HEAD", "--", relPath]);
    },
    async statusPorcelain() {
      return runGit(root, ["status", "--porcelain"]);
    },
```

- [ ] **Step 4: Run** `npx vitest run test/workspace.dashboard.test.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts test/workspace.dashboard.test.ts
git commit -m "feat(dashboard): workspace read/diff/uncommitted-changes"
```

---

## Task 3: Review-mode query (commit: false)

**Files:** Modify `src/query.ts`, `src/ingest.ts`; Test `test/query.reviewmode.test.ts` (create).

- [ ] **Step 1: Write the failing test** — create `test/query.reviewmode.test.ts`:

```typescript
import { expect, test } from "vitest";
import { query, type QueryDeps } from "../src/query.js";
import { createRunManager } from "../src/runManager.js";
import type { EngineEvent } from "../src/engine.js";

function fakeWorkspace() {
  const calls: string[] = [];
  return {
    calls, root: "/vault",
    init: async () => {}, isClean: async () => true, head: async () => "HEAD0",
    commitAll: async (m: string) => { calls.push(`commit:${m}`); return "C1"; },
    resetToHead: async () => { calls.push("reset"); },
    changedFilesSince: async () => ["should-not-be-used.md"],
    uncommittedChanges: async () => ["clients/x.md"],
    fileContent: async () => "", diff: async () => "",
  };
}
const fakeEngine = (events: EngineEvent[]) => async function* () { for (const e of events) yield e; };
function deps(over: Partial<QueryDeps>): QueryDeps {
  return {
    workspace: fakeWorkspace() as any,
    engine: fakeEngine([{ type: "result", text: "done" }]) as any,
    runManager: createRunManager({ maxRuntimeMs: 1000, queueLimit: 4 }),
    eventLog: { append: async () => {} } as any,
    systemPrompt: "SYS",
    ...over,
  };
}

test("commit:false leaves changes uncommitted and reports working-tree files", async () => {
  const d = deps({});
  const res = await query(d, "edit X", undefined, { commit: false });
  expect(res.commit).toBeNull();
  expect(res.filesTouched).toEqual(["clients/x.md"]);
  // no commit was made (neither the change commit nor the log commit)
  expect((d.workspace as any).calls.filter((c: string) => c.startsWith("commit:"))).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run test/query.reviewmode.test.ts` → FAIL (4th arg ignored; commit still happens).

- [ ] **Step 3: Implement** — in `src/query.ts`:

Add the `uncommittedChanges`/`fileContent`/`diff` methods to the `Workspace` type used by `QueryDeps`? No — `QueryDeps.workspace` is typed as `Workspace` from `./workspace.js`, which now includes them (Task 2). Good.

Change the `query` signature and success path. Replace the function signature:

```typescript
export async function query(
  deps: QueryDeps,
  instruction: string,
  onProgress?: (message: string) => void,
  opts?: { commit?: boolean },
): Promise<QueryResult> {
```

Inside the `runManager.run` callback, replace the success block (from `const commit = await deps.workspace.commitAll(...)` through the `return`) with:

```typescript
      if (opts?.commit === false) {
        // Review mode (dashboard): leave changes uncommitted for the human to Commit/Verwerp.
        const filesTouched = await deps.workspace.uncommittedChanges();
        return { runId, text: finalText, commit: null, filesTouched };
      }
      const commit = await deps.workspace.commitAll(`query ${runId}: ${truncate(instruction, 60)}`);
      const filesTouched = commit ? await deps.workspace.changedFilesSince(before) : [];
      await deps.eventLog.append({ runId, instruction, status: "ok", commit, summary: truncate(finalText) });
      await deps.workspace.commitAll(`query ${runId}: log`);
      return { runId, text: finalText, commit, filesTouched };
```

Leave the `catch` (failure) block unchanged — on failure it still resets and rethrows. In review mode the workspace was clean-or-reset at the start, so a failed review run also resets, discarding partial writes (correct).

- [ ] **Step 4: Thread through `remember`** — in `src/ingest.ts` change the `remember` signature + call:

```typescript
export async function remember(
  deps: QueryDeps,
  args: RememberArgs,
  onProgress?: (message: string) => void,
  opts?: { commit?: boolean },
): Promise<QueryResult> {
  if (!args.content || !args.content.trim()) {
    throw new Error("remember: content is required and cannot be empty");
  }
  return query(deps, buildIngestInstruction(args.content, args.source, args.title), onProgress, opts);
}
```

- [ ] **Step 5: Run** `npx vitest run test/query.reviewmode.test.ts test/query.test.ts test/ingest.test.ts` → all PASS (existing default-mode tests still green; review-mode passes).

- [ ] **Step 6: Commit**

```bash
git add src/query.ts src/ingest.ts test/query.reviewmode.test.ts
git commit -m "feat(dashboard): review-mode query (commit:false) + remember passthrough"
```

---

## Task 4: Session module (login + signed cookie + guard)

**Files:** Create `src/dashboard/session.ts`, `test/dashboard/session.test.ts`.

- [ ] **Step 1: Write the failing test** — create `test/dashboard/session.test.ts`:

```typescript
import { expect, test, vi } from "vitest";
import { signSession, verifySession, parseCookie } from "../../src/dashboard/session.js";

const key = Buffer.from("k".repeat(32));

test("signSession round-trips and verifies; tampered/expired fail", () => {
  const now = 1_000_000;
  const tok = signSession(key, 60_000, () => now);
  expect(verifySession(key, tok, () => now)).toBe(true);
  expect(verifySession(key, tok + "x", () => now)).toBe(false);
  expect(verifySession(key, tok, () => now + 61_000)).toBe(false); // expired
});

test("parseCookie reads a named cookie from a Cookie header", () => {
  expect(parseCookie("a=1; geode_session=abc.def; b=2", "geode_session")).toBe("abc.def");
  expect(parseCookie(undefined, "geode_session")).toBeNull();
});
```

- [ ] **Step 2: Run** `npx vitest run test/dashboard/session.test.ts` → FAIL.

- [ ] **Step 3: Implement** — create `src/dashboard/session.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE = "geode_session";

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/** Token = "<exp>.<sig>" where sig = HMAC(key, exp). exp is ms-since-epoch. */
export function signSession(key: Buffer, ttlMs: number, now: () => number = Date.now): string {
  const exp = String(now() + ttlMs);
  return `${exp}.${sign(key, exp)}`;
}

export function verifySession(key: Buffer, token: string, now: () => number = Date.now): boolean {
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now()) return false;
  const expected = sign(key, exp);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  const attrs = [`${COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=86400"];
  if (secure) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
}

/** Express middleware: 401 unless a valid session cookie is present. */
export function requireSession(key: Buffer) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tok = parseCookie(req.headers.cookie, COOKIE);
    if (tok && verifySession(key, tok)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}
```

- [ ] **Step 4: Run** `npx vitest run test/dashboard/session.test.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/session.ts test/dashboard/session.test.ts
git commit -m "feat(dashboard): signed session cookie + requireSession guard"
```

---

## Task 5: Knowledge module (tree, status, path-safe read/diff)

**Files:** Create `src/dashboard/knowledge.ts`, `test/dashboard/knowledge.test.ts`.

Knowledge = the git-tracked OKF content. Exclude machinery (`integrations/`, `artifacts/`) and `.git`.

- [ ] **Step 1: Write the failing test** — create `test/dashboard/knowledge.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKnowledgeTree, parseStatus } from "../../src/dashboard/knowledge.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-kn-"));
  writeFileSync(join(root, "index.md"), "i");
  mkdirSync(join(root, "clients")); writeFileSync(join(root, "clients", "x.md"), "x");
  mkdirSync(join(root, "integrations", "moneybird"), { recursive: true });
  writeFileSync(join(root, "integrations", "moneybird", "manifest.json"), "{}");
  mkdirSync(join(root, "artifacts")); writeFileSync(join(root, "artifacts", "out.md"), "o");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("buildKnowledgeTree includes knowledge, excludes integrations/artifacts/.git", async () => {
  const tree = await buildKnowledgeTree(root);
  const names = tree.map((n) => n.name).sort();
  expect(names).toContain("index.md");
  expect(names).toContain("clients");
  expect(names).not.toContain("integrations");
  expect(names).not.toContain("artifacts");
  const clients = tree.find((n) => n.name === "clients")!;
  expect(clients.type).toBe("dir");
  expect(clients.children!.map((c) => c.path)).toEqual(["clients/x.md"]);
});

test("parseStatus splits modified vs created", () => {
  const out = parseStatus(" M index.md\n?? note.md\nA  clients/y.md");
  expect(out.modified).toContain("index.md");
  expect(out.created.sort()).toEqual(["clients/y.md", "note.md"]);
});
```

- [ ] **Step 2: Run** `npx vitest run test/dashboard/knowledge.test.ts` → FAIL.

- [ ] **Step 3: Implement** — create `src/dashboard/knowledge.ts`:

```typescript
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface TreeNode { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] }

const HIDDEN = new Set([".git", "integrations", "artifacts", ".gitignore", "node_modules"]);

export async function buildKnowledgeTree(root: string, rel = ""): Promise<TreeNode[]> {
  const dir = rel ? join(root, rel) : root;
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (rel === "" && HIDDEN.has(e.name)) continue;
    if (e.name.startsWith(".")) continue;
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path, type: "dir", children: await buildKnowledgeTree(root, path) });
    } else {
      nodes.push({ name: e.name, path, type: "file" });
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return nodes;
}

/** git status --porcelain → {modified, created}. "??"/"A" = created; everything else with a path = modified. */
export function parseStatus(porcelain: string): { modified: string[]; created: string[] } {
  const modified: string[] = [], created: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2), path = line.slice(3);
    if (code === "??" || code[0] === "A") created.push(path);
    else modified.push(path);
  }
  return { modified, created };
}
```

- [ ] **Step 4: Run** `npx vitest run test/dashboard/knowledge.test.ts` → PASS (2).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/knowledge.ts test/dashboard/knowledge.test.ts
git commit -m "feat(dashboard): knowledge tree + status parsing"
```

---

## Task 6: SSE helper

**Files:** Create `src/dashboard/sse.ts`, `test/dashboard/sse.test.ts`.

- [ ] **Step 1: Write the failing test** — create `test/dashboard/sse.test.ts`:

```typescript
import { expect, test } from "vitest";
import { openSse } from "../../src/dashboard/sse.js";

function fakeRes() {
  const chunks: string[] = []; let ended = false; const headers: Record<string, string> = {};
  return {
    chunks, get ended() { return ended; }, headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    write(s: string) { chunks.push(s); return true; },
    end() { ended = true; },
    flushHeaders() {},
  } as any;
}

test("openSse sets headers and frames events as `event:`/`data:`", () => {
  const res = fakeRes();
  const sse = openSse(res);
  sse.send("progress", { message: "step 1" });
  sse.send("result", { text: "done" });
  sse.close();
  expect(res.headers["Content-Type"]).toBe("text/event-stream");
  expect(res.chunks.join("")).toBe(
    'event: progress\ndata: {"message":"step 1"}\n\nevent: result\ndata: {"text":"done"}\n\n',
  );
  expect(res.ended).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run test/dashboard/sse.test.ts` → FAIL.

- [ ] **Step 3: Implement** — create `src/dashboard/sse.ts`:

```typescript
import type { Response } from "express";

export interface SseChannel { send(event: string, data: unknown): void; close(): void }

export function openSse(res: Response): SseChannel {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  return {
    send(event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    close() { res.end(); },
  };
}
```

- [ ] **Step 4: Run** `npx vitest run test/dashboard/sse.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/sse.ts test/dashboard/sse.test.ts
git commit -m "feat(dashboard): SSE channel helper"
```

---

## Task 7: `/api` router

**Files:** Create `src/dashboard/api.ts`, `test/dashboard/api.test.ts`.

The router is built by a factory that takes its dependencies, so it is testable by mounting it on a bare Express app and driving it with `fetch` against an ephemeral port (the kernel's own e2e uses real HTTP; we do the same here for the router).

**ApiDeps shape** (reuses existing kernel types):

```typescript
export interface ApiDeps {
  sessionKey: Buffer;
  dashboardPassword: string;
  secure: boolean;                         // Set-Cookie Secure flag (true behind https)
  workspace: import("../workspace.js").Workspace;
  runQuery: (instruction: string, onProgress: (m: string) => void) => Promise<import("../query.js").QueryResult>;
  runRemember: (args: import("../ingest.js").RememberArgs, onProgress: (m: string) => void) => Promise<import("../query.js").QueryResult>;
}
```

- [ ] **Step 1: Write the failing test** — create `test/dashboard/api.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";

let server: Server; let url: string; let root: string;
const KEY = Buffer.from("k".repeat(32));

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-api-"));
  const ws = createWorkspace(root); await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\n"); await ws.commitAll("seed");
  const app = express(); app.use(express.json());
  app.use("/api", createApiRouter({
    sessionKey: KEY, dashboardPassword: "pw", secure: false, workspace: ws,
    runQuery: async (instruction, onProgress) => { onProgress("thinking"); writeFileSync(join(root, "note.md"), "x"); return { runId: "r1", text: "ok: " + instruction, commit: null, filesTouched: ["note.md"] }; },
    runRemember: async (_args, onProgress) => { onProgress("filing"); return { runId: "r2", text: "filed", commit: null, filesTouched: [] }; },
  }));
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
const login = async () => {
  const res = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw" }) });
  return res.headers.get("set-cookie")!.split(";")[0];
};

beforeEach(boot);
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("guards /api/tree until logged in; login sets a cookie", async () => {
  expect((await fetch(`${url}/api/tree`)).status).toBe(401);
  expect((await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) })).status).toBe(401);
  const cookie = await login();
  const res = await fetch(`${url}/api/tree`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const tree = await res.json();
  expect(tree.map((n: any) => n.name)).toContain("index.md");
});

test("POST /api/query streams SSE progress then a result event", async () => {
  const cookie = await login();
  const res = await fetch(`${url}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "do X" }) });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  expect(body).toContain("event: progress");
  expect(body).toContain("thinking");
  expect(body).toContain("event: result");
  expect(body).toContain("ok: do X");
});

test("commit then discard operate on the working tree", async () => {
  const cookie = await login();
  writeFileSync(join(root, "index.md"), "# Index\nedited\n");
  const c = await fetch(`${url}/api/commit`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ message: "m" }) });
  expect((await c.json()).commit).toBeTruthy();
  const s = await (await fetch(`${url}/api/status`, { headers: { cookie } })).json();
  expect(s.modified).toEqual([]); expect(s.created).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run test/dashboard/api.test.ts` → FAIL (`createApiRouter` missing).

- [ ] **Step 3: Implement** — create `src/dashboard/api.ts`:

```typescript
import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Workspace } from "../workspace.js";
import type { QueryResult } from "../query.js";
import type { RememberArgs } from "../ingest.js";
import { signSession, requireSession, setSessionCookie, clearSessionCookie } from "./session.js";
import { buildKnowledgeTree, parseStatus } from "./knowledge.js";
import { openSse } from "./sse.js";

export interface ApiDeps {
  sessionKey: Buffer;
  dashboardPassword: string;
  secure: boolean;
  workspace: Workspace;
  runQuery: (instruction: string, onProgress: (m: string) => void) => Promise<QueryResult>;
  runRemember: (args: RememberArgs, onProgress: (m: string) => void) => Promise<QueryResult>;
}

const SESSION_TTL = 86_400_000; // 24h

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();

  router.post("/login", (req: Request, res: Response) => {
    const password = String(req.body?.password ?? "");
    const a = Buffer.from(password), b = Buffer.from(deps.dashboardPassword);
    if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: "invalid password" }); return; }
    setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL), deps.secure);
    res.json({ ok: true });
  });
  router.post("/logout", (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

  // everything below requires a session
  router.use(requireSession(deps.sessionKey));

  const stream = (run: (op: (m: string) => void) => Promise<QueryResult>) => async (_req: Request, res: Response) => {
    const sse = openSse(res);
    try {
      const result = await run((m) => sse.send("progress", { message: m }));
      sse.send("result", result);
    } catch (e) {
      sse.send("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      sse.close();
    }
  };
  router.post("/query", (req, res) => stream((op) => deps.runQuery(String(req.body?.instruction ?? ""), op))(req, res));
  router.post("/remember", (req, res) => stream((op) => deps.runRemember(req.body ?? {}, op))(req, res));

  router.get("/tree", async (_req, res) => { res.json(await buildKnowledgeTree(deps.workspace.root)); });
  router.get("/status", async (_req, res) => { res.json(parseStatus(await deps.workspace.statusPorcelain())); });
  router.get("/file", async (req, res) => {
    try { res.json({ content: await deps.workspace.fileContent(String(req.query.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.get("/diff", async (req, res) => {
    try { res.json({ diff: await deps.workspace.diff(String(req.query.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.post("/commit", async (req, res) => {
    const commit = await deps.workspace.commitAll(String(req.body?.message || "dashboard: commit changes"));
    res.json({ commit });
  });
  router.post("/discard", async (_req, res) => { await deps.workspace.resetToHead(); res.json({ ok: true }); });

  return router;
}
```

(`statusPorcelain` and the other workspace methods come from Task 2; `parseStatus`/`buildKnowledgeTree` from Task 5.)

- [ ] **Step 4: Run** `npx vitest run test/dashboard/api.test.ts` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/api.ts test/dashboard/api.test.ts
git commit -m "feat(dashboard): /api router (login, SSE query/remember, tree/file/diff/status/commit/discard)"
```

---

## Task 8: Mount the dashboard + wire into the kernel

**Files:** Create `src/dashboard/index.ts`; Modify `src/index.ts`. (No new unit test — covered by the api test + the manual e2e; verify with `tsc` + a boot smoke.)

- [ ] **Step 1: Implement** `src/dashboard/index.ts`:

```typescript
import type { Express } from "express";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApiRouter, type ApiDeps } from "./api.js";

export interface DashboardDeps extends Omit<ApiDeps, "secure"> {
  webDir: string;   // absolute path to the built SPA (web/dist)
  secure?: boolean;
}

/** Mounts /api and the static SPA on the given Express app. Call only when the dashboard is enabled. */
export function mountDashboard(app: Express, deps: DashboardDeps): void {
  app.use("/api", createApiRouter({ ...deps, secure: deps.secure ?? false }));
  if (existsSync(deps.webDir)) {
    app.use(express.static(deps.webDir));
    // SPA fallback: any non-/api, non-/mcp, non-/artifacts GET returns index.html
    app.get(/^\/(?!api\/|mcp$|artifacts\/).*/, (_req, res) => { res.sendFile(join(deps.webDir, "index.html")); });
  }
}
```

- [ ] **Step 2: Wire into `src/index.ts`** — after the artifact store is built and before `buildHttpApp`, build the session key and pass a post-mount hook. The cleanest seam: `buildHttpApp` already returns the `app`; mount the dashboard on it before `listen`. Add imports:

```typescript
import { mountDashboard } from "./dashboard/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query } from "./query.js";
import { remember } from "./ingest.js";
import { loadOrCreateKey } from "./secrets.js";
```

Replace the `const app = buildHttpApp(...)` + `app.listen(...)` block with:

```typescript
  const app = buildHttpApp(() => buildMcpServer(queryDeps, { secrets, artifacts }), config.authToken, artifacts);

  if (config.dashboardPassword) {
    const sessionKey = loadOrCreateKey(join(config.secretsDir, "session"), process.env.GEODE_SESSION_KEY);
    const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
    mountDashboard(app, {
      sessionKey,
      dashboardPassword: config.dashboardPassword,
      secure: config.baseUrl.startsWith("https://"),
      workspace,
      webDir,
      runQuery: (instruction, onProgress) => query(queryDeps, instruction, onProgress, { commit: false }),
      runRemember: (args, onProgress) => remember(queryDeps, args, onProgress, { commit: false }),
    });
    console.log(`Dashboard enabled at ${config.baseUrl}/`);
  }

  app.listen(config.port, () => {
    console.log(`Geode kernel listening on http://localhost:${config.port}/mcp (workspace: ${config.workspaceRoot})`);
  });
```

(Note: the dashboard runs `query`/`remember` in **review mode** — `commit: false` — so edits await human Commit/Verwerp.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` → clean. `npm test` → all green. Boot smoke:

```bash
GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=$(mktemp -d) GEODE_DASHBOARD_PASSWORD=pw GEODE_SECRETS_DIR=$(mktemp -d) npx tsx src/index.ts &
sleep 2
curl -s -o /dev/null -w "tree-unauthed=%{http_code}\n" http://localhost:8787/api/tree   # expect 401
curl -s -o /dev/null -w "login=%{http_code}\n" -X POST -H 'content-type: application/json' -d '{"password":"pw"}' http://localhost:8787/api/login  # expect 200
kill %1
```
Expected: `tree-unauthed=401`, `login=200`.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/index.ts src/index.ts
git commit -m "feat(dashboard): mount /api + static SPA on the kernel when enabled"
```

---

## Task 9: SPA scaffold + API/SSE client

**Files:** Create `web/` (Vite React TS project) + `web/src/api.ts` + `web/src/api.test.ts`.

- [ ] **Step 1: Scaffold** — from the repo root (also ignore SPA build/deps so they are never committed):

```bash
mkdir -p web/src
printf '\nweb/node_modules\nweb/dist\n' >> .gitignore
git add .gitignore && git commit -m "chore: gitignore web/ build + deps"
```
Create `web/package.json`:
```json
{
  "name": "geode-web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "test": "vitest run" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": {
    "@testing-library/react": "^16.0.1", "@types/react": "^18.3.12", "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4", "jsdom": "^25.0.1", "typescript": "^5.6.3", "vite": "^5.4.11", "vitest": "^2.1.8"
  }
}
```
Create `web/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: { proxy: { "/api": "http://localhost:8787" } }, // dev: proxy API to the kernel
  test: { environment: "jsdom" },
});
```
Create `web/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "skipLibCheck": true, "noEmit": true }, "include": ["src"] }
```
Create `web/index.html`:
```html
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Geode</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&family=Onest:wght@500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
</head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```
Then install: `cd web && npm install && cd ..`

- [ ] **Step 2: Write the failing test** — create `web/src/api.test.ts`:

```typescript
import { expect, test } from "vitest";
import { parseSseChunk } from "./api";

test("parseSseChunk yields complete events and keeps the remainder", () => {
  const { events, rest } = parseSseChunk('event: progress\ndata: {"message":"hi"}\n\nevent: res');
  expect(events).toEqual([{ event: "progress", data: { message: "hi" } }]);
  expect(rest).toBe("event: res");
});
```

- [ ] **Step 3: Run** `cd web && npx vitest run src/api.test.ts` → FAIL.

- [ ] **Step 4: Implement** — create `web/src/api.ts`:

```typescript
export interface TreeNode { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] }
export interface SseEvent { event: string; data: any }

/** Parse a buffer of SSE text into complete events + the unparsed remainder. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    let event = "message", data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) events.push({ event, data: JSON.parse(data) });
  }
  return { events, rest };
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  login: (password: string) => json<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => json("/api/logout", { method: "POST" }),
  tree: () => json<TreeNode[]>("/api/tree"),
  file: (path: string) => json<{ content: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  diff: (path: string) => json<{ diff: string }>(`/api/diff?path=${encodeURIComponent(path)}`),
  status: () => json<{ modified: string[]; created: string[] }>("/api/status"),
  commit: (message?: string) => json<{ commit: string | null }>("/api/commit", { method: "POST", body: JSON.stringify({ message }) }),
  discard: () => json<{ ok: true }>("/api/discard", { method: "POST" }),
  /** Stream an agent run; calls onEvent for each SSE event until the stream closes. */
  async run(path: "/api/query" | "/api/remember", body: object, onEvent: (e: SseEvent) => void): Promise<void> {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buf); buf = rest;
      for (const e of events) onEvent(e);
    }
  },
};
```

- [ ] **Step 5: Run** `cd web && npx vitest run src/api.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vite.config.ts web/tsconfig.json web/index.html web/src/api.ts web/src/api.test.ts web/package-lock.json
git commit -m "feat(dashboard): SPA scaffold (Vite/React/TS) + api/SSE client"
```

---

## Task 10: SPA views — Login + 3-pane Vault home

**Files:** Create `web/src/main.tsx`, `web/src/App.tsx`, `web/src/app.css`, `web/src/views/Login.tsx`, `web/src/views/VaultHome.tsx`, `web/src/components/{TopBar,Chat,FileTree,Viewer}.tsx`.

The **markup + styling already exist** in `docs/design/mockups/dashboard-home-with-nav.html` and `docs/design/app.css`. Port them: copy the mockup's `<style>` block into `web/src/app.css` (and append any rule already present in `docs/design/app.css` that the components reference), then translate each mockup region into the component below, replacing static content with props/state. Do **not** invent new visual styles — reuse the mockup's classes (`topbar`, `chat`, `tree`, `viewer`, `bubble`, `card`, `row`, `dot-mod`, `badge new`, `pre`, `add`, `del`, `btn`, `ghost`, etc.).

- [ ] **Step 1: `web/src/app.css`** — paste the full contents of the `<style>` element from `docs/design/mockups/dashboard-home-with-nav.html` (the `:root` tokens + all component classes). This is the styling source of truth for the SPA.

- [ ] **Step 2: `web/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import { App } from "./App";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 3: `web/src/App.tsx`** — session gate: try `api.tree()`; on 401 show Login, else VaultHome.

```tsx
import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./views/Login";
import { VaultHome } from "./views/VaultHome";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { api.tree().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return null;
  return authed ? <VaultHome /> : <Login onIn={() => setAuthed(true)} />;
}
```

- [ ] **Step 4: `web/src/views/Login.tsx`** — port the centered card from `docs/design/mockups/auth-screen.html` (the card shell + `.input`/`.btn`), simplified to a single password field.

```tsx
import { useState } from "react";
import { api } from "../api";
export function Login({ onIn }: { onIn: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); try { await api.login(pw); onIn(); } catch { setErr("Onjuist wachtwoord"); } };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <form className="card" style={{ width: 360 }} onSubmit={submit}>
        <span className="eyebrow">Geode</span>
        <h2>Inloggen</h2>
        <input className="input" type="password" placeholder="Dashboard-wachtwoord" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p style={{ color: "#eaa", fontSize: 13 }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 12 }}>Inloggen</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: `web/src/components/TopBar.tsx`** — port the `.topbar` region (brand + workspace chip + nav + live chip + avatar). The nav items render as static for now (only **Vault** is active in Increment A; Capabilities/Integrations/Secrets/Artifacts are inert links — they light up in Increment B).

```tsx
export function TopBar() {
  const items = ["Vault", "Capabilities", "Integrations", "Secrets", "Artifacts"];
  return (
    <div className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="12,2 22,9 12,22" fill="#3FCFA1"/><polygon points="12,2 2,9 12,22" fill="#86ECCB"/><polygon points="2,9 12,22 22,9" fill="#4C7DF4" opacity=".85"/></svg>
        <span className="name">Geode</span>
        <span className="ws">personal-vault</span>
      </div>
      <nav>{items.map((it, i) => <a key={it} className={i === 0 ? "active" : ""}>{it}</a>)}</nav>
      <div className="tb-right"><span className="chip live"><span className="pulse" />live</span><span className="avatar" /></div>
    </div>
  );
}
```

- [ ] **Step 6: `web/src/views/VaultHome.tsx`** — the 3-pane container + state. Holds: tree, selected file, its diff, agent run state, status badges.

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent } from "../api";
import { TopBar } from "../components/TopBar";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { Viewer } from "../components/Viewer";

export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    setTree(await api.tree()); setStatus(await api.status());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (selected) api.diff(selected).then((d) => setDiff(d.diff)); }, [selected, status]);

  const dirty = status.modified.length + status.created.length > 0;

  const send = async (instruction: string, onEvent: (e: SseEvent) => void) => {
    setRunning(true);
    try {
      await api.run("/api/query", { instruction }, (e) => {
        onEvent(e);
        if (e.event === "result") { const f = e.data.filesTouched?.[0]; if (f) setSelected(f); }
      });
      await refresh();
    } finally { setRunning(false); }
  };
  const commit = async () => { await api.commit(); await refresh(); setDiff(""); };
  const discard = async () => { await api.discard(); await refresh(); setDiff(""); };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar />
      <div className="main">
        <Chat onSend={send} running={running} />
        <FileTree tree={tree} status={status} selected={selected} onSelect={setSelected} />
        <Viewer path={selected} diff={diff} dirty={dirty} onCommit={commit} onDiscard={discard} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: `web/src/components/Chat.tsx`** — message list + change-cards + composer; streams progress via `onSend`.

```tsx
import { useState } from "react";
import type { SseEvent } from "../api";
type Msg = { who: "me" | "ag" | "card" | "progress"; text: string };
export function Chat({ onSend, running }: { onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>; running: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const submit = async () => {
    const instruction = text.trim(); if (!instruction || running) return;
    setText(""); setMsgs((m) => [...m, { who: "me", text: instruction }]);
    await onSend(instruction, (e) => {
      if (e.event === "progress") setMsgs((m) => [...m, { who: "progress", text: e.data.message }]);
      else if (e.event === "result") setMsgs((m) => [...m, { who: "card", text: e.data.text }]);
      else if (e.event === "error") setMsgs((m) => [...m, { who: "ag", text: "Fout: " + e.data.message }]);
    });
  };
  return (
    <div className="col chat">
      <div className="eyebrow">Vault agent</div>
      <div className="msgs">
        {msgs.map((m, i) => m.who === "card"
          ? <div key={i} className="card"><span>{m.text}</span></div>
          : <div key={i} className={`bubble ${m.who === "me" ? "me" : "ag"}`} style={m.who === "progress" ? { opacity: .6, fontSize: 13 } : undefined}>{m.text}</div>)}
      </div>
      <div className="ctrl">
        <input className="input" placeholder="Praat met je vault…" value={text} disabled={running}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: `web/src/components/FileTree.tsx`** — render the tree with status badges (amber dot = modified, emerald "nieuw" = created).

```tsx
import type { TreeNode } from "../api";
export function FileTree({ tree, status, selected, onSelect }: {
  tree: TreeNode[]; status: { modified: string[]; created: string[] }; selected: string | null; onSelect: (p: string) => void;
}) {
  const render = (nodes: TreeNode[], depth = 0) => nodes.map((n) => (
    <div key={n.path}>
      <div className={`row ${n.type === "file" && depth > 0 ? "sub" : ""} ${selected === n.path ? "active" : ""}`}
        style={{ paddingLeft: 20 + depth * 16 }} onClick={() => n.type === "file" && onSelect(n.path)}>
        <span>{n.name}</span>
        <span className="spacer" />
        {status.modified.includes(n.path) && <span className="dot-mod" />}
        {status.created.includes(n.path) && <span className="badge new">nieuw</span>}
      </div>
      {n.children && render(n.children, depth + 1)}
    </div>
  ));
  return <div className="col tree"><div className="eyebrow">Vault</div><div className="tree-list">{render(tree)}</div></div>;
}
```

- [ ] **Step 9: `web/src/components/Viewer.tsx`** — render the diff (color add/del lines) with the Commit/Verwerp bar (only when dirty).

```tsx
export function Viewer({ path, diff, dirty, onCommit, onDiscard }: {
  path: string | null; diff: string; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  return (
    <div className="col viewer">
      <div className="panel-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="tl"><span /><span /><span /></div>
          <span className="fname">{path ?? "—"}</span>
          {dirty && <span className="uncommitted"><span className="dot-mod" />niet-gecommit</span>}
        </div>
        {dirty && <div style={{ display: "flex", gap: 10 }}><button className="ghost" onClick={onDiscard}>Verwerp</button><button className="btn" onClick={onCommit}>Commit</button></div>}
      </div>
      <div className="pre">
        {diff ? diff.split("\n").map((l, i) => (
          <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : ""}>{l || " "}</div>
        )) : <div style={{ color: "var(--faint)" }}>Selecteer een bestand of stel de agent een vraag.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Build check** `cd web && npm run build` → succeeds, emits `web/dist/`. `npx vitest run` (in web) → the api test passes.

- [ ] **Step 11: Commit**

```bash
git add web/src
git commit -m "feat(dashboard): login + 3-pane Vault home (chat/tree/viewer + review commit)"
```

---

## Task 11: Full verify + manual e2e

**Files:** Create `test/dashboard.e2e.manual.md`. Verify the whole increment.

- [ ] **Step 1: Backend green** — from the repo root: `npm test` (all kernel + dashboard tests) and `npx tsc --noEmit` → green/clean. `npm run build` → succeeds.

- [ ] **Step 2: SPA build** — `cd web && npm run build && cd ..` → `web/dist` exists.

- [ ] **Step 3: Write `test/dashboard.e2e.manual.md`:**

```markdown
# Dashboard (Increment A) E2E smoke (manual)

Needs a reachable model (`ANTHROPIC_API_KEY` or local Ollama). Build the SPA first: `cd web && npm run build && cd ..`.

1. `export GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=$(mktemp -d) GEODE_DASHBOARD_PASSWORD=pw`
2. `npm start` → console shows "Dashboard enabled at http://localhost:8787/".
3. Open `http://localhost:8787/` → the **login** screen. Wrong password → error; `pw` → the 3-pane Vault home.
4. In the chat: "Maak een notitie clients/test.md met één zin over deze vault."
   - Progress streams in the chat (SSE); a result change-card appears.
   - The new file appears in the tree with an emerald **nieuw** badge; selecting it shows a green-add **diff** in the viewer; the viewer shows **niet-gecommit** + Commit/Verwerp.
5. Click **Commit** → badges clear; `git -C $GEODE_WORKSPACE log --oneline` shows the commit. (Or **Verwerp** → the change disappears and the working tree is clean.)
6. Start another run while changes are pending → blocked until you Commit/Verwerp (the run resets a dirty tree at start; confirm you commit first).
7. Reload → still logged in (session cookie); `POST /api/logout` (or clear the cookie) → back to login.
```

- [ ] **Step 4: Run the manual e2e once** (with a real model) and confirm the flow. Fix anything that surfaces.

- [ ] **Step 5: Commit**

```bash
git add test/dashboard.e2e.manual.md
git commit -m "docs(dashboard): manual e2e checklist for Increment A"
```

---

## Notes for the implementer
- The dashboard calls `query`/`remember` in **review mode** (`commit: false`); never auto-commit from the dashboard. MCP keeps auto-commit (unchanged).
- Keep exported names exact: `signSession`/`verifySession`/`parseCookie`/`requireSession`/`setSessionCookie`/`clearSessionCookie`, `buildKnowledgeTree`/`parseStatus`, `openSse`, `createApiRouter`/`ApiDeps`, `mountDashboard`/`DashboardDeps`, `parseSseChunk`/`api`.
- Build artifacts: `web/dist` is generated; add `web/dist` and `web/node_modules` to `.gitignore` (repo root) in Task 9 if not already ignored.
- Express 5 RegExp route in `mountDashboard` excludes `/api`, `/mcp`, `/artifacts` from the SPA fallback so those keep working.
- The `/api` router must be mounted **after** `express.json()` — `buildHttpApp` already calls `app.use(express.json(...))`, and `mountDashboard` runs on that same app, so JSON body parsing is available.

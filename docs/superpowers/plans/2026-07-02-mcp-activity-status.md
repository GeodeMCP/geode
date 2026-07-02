# MCP Activity Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard a real "last MCP activity" signal (replacing the removed fake chip), plus fix the `npm start` env / missing-workspace papercut (#3).

**Architecture:** An in-memory `McpActivity` recorder is written at the authenticated `/mcp` boundary and read by a session-guarded `GET /api/mcp-status`. A defensive polling `<McpStatus>` widget in the top bar renders "no calls yet" / "MCP · 2m ago · query". Honest for stateless HTTP: it reports last activity since the kernel started, not a persistent connection.

**Tech Stack:** Node/TypeScript (tsx), Express, `@modelcontextprotocol/sdk`; React 18 + Vite + Vitest/@testing-library (jsdom for web).

## Global Constraints

- **All UI strings English** (memory `english-only-app-strings`).
- **New top-level exports need JSDoc** or the husky pre-commit gate blocks (memory `precommit-quality-gate`).
- Follow existing patterns; keep files focused.
- `src/index.ts` runs `main()` on import — do NOT put unit-tested helpers there; put the workspace guard in `src/config.ts` (import-safe).
- The `<McpStatus>` widget MUST optional-chain the api call (`api.mcpStatus?.()`) and render `null` on missing/failed fetch — this is the defensive lesson from the VaultHome regression.
- Backend tests: `npm test` (root, node env). Web: `cd web && npm test` (jsdom), `npm run typecheck`, `npm run build`.

---

### Task 1: `McpActivity` recorder + `toolFromBody` (pure)

**Files:**
- Create: `src/mcpActivity.ts`
- Test: `test/mcpActivity.test.ts`

**Interfaces:**
- Produces: `McpActivitySnapshot = { lastAt: string | null; lastTool: string | null; count: number }`; `McpActivity = { record(tool: string | null): void; snapshot(): McpActivitySnapshot }`; `createMcpActivity(now?: () => string): McpActivity`; `toolFromBody(body: unknown): string | null`.

- [ ] **Step 1: Write the failing test** — `test/mcpActivity.test.ts`

```ts
import { expect, test } from "vitest";
import { createMcpActivity, toolFromBody } from "../src/mcpActivity.js";

test("toolFromBody maps tools/call to the tool name, other methods to the method, junk to null", () => {
  expect(toolFromBody({ method: "tools/call", params: { name: "query" } })).toBe("query");
  expect(toolFromBody({ method: "tools/list" })).toBe("tools/list");
  expect(toolFromBody({ method: "initialize" })).toBe("initialize");
  expect(toolFromBody(null)).toBeNull();
  expect(toolFromBody([{ method: "tools/call" }])).toBeNull();
  expect(toolFromBody({ params: { name: "x" } })).toBeNull();
});

test("createMcpActivity records last time/tool and a running count; a null tool keeps the previous tool", () => {
  let t = 0;
  const a = createMcpActivity(() => `2026-01-01T00:00:0${t}Z`);
  expect(a.snapshot()).toEqual({ lastAt: null, lastTool: null, count: 0 });
  t = 1; a.record("query");
  expect(a.snapshot()).toEqual({ lastAt: "2026-01-01T00:00:01Z", lastTool: "query", count: 1 });
  t = 2; a.record(null);
  expect(a.snapshot()).toEqual({ lastAt: "2026-01-01T00:00:02Z", lastTool: "query", count: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mcpActivity`
Expected: FAIL — `Cannot find module '../src/mcpActivity.js'`.

- [ ] **Step 3: Write minimal implementation** — `src/mcpActivity.ts`

```ts
/** A point-in-time view of MCP activity since the kernel started. */
export interface McpActivitySnapshot { lastAt: string | null; lastTool: string | null; count: number; }

/** Records and reports the most recent authenticated MCP request. */
export interface McpActivity {
  record(tool: string | null): void;
  snapshot(): McpActivitySnapshot;
}

/** Best-effort extraction of the invoked tool name from a JSON-RPC request body (tools/call → tool name, else the method). */
export function toolFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const method = (body as { method?: unknown }).method;
  if (typeof method !== "string") return null;
  if (method === "tools/call") {
    const name = (body as { params?: { name?: unknown } }).params?.name;
    return typeof name === "string" ? name : null;
  }
  return method;
}

/** Creates an in-memory MCP activity recorder; resets when the kernel restarts. */
export function createMcpActivity(now: () => string = () => new Date().toISOString()): McpActivity {
  let lastAt: string | null = null;
  let lastTool: string | null = null;
  let count = 0;
  return {
    record(tool) { lastAt = now(); if (tool) lastTool = tool; count += 1; },
    snapshot() { return { lastAt, lastTool, count }; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mcpActivity`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcpActivity.ts test/mcpActivity.test.ts
git commit -m "feat(status): in-memory MCP activity recorder + toolFromBody"
```

---

### Task 2: Wire recording into `/mcp` and expose `GET /api/mcp-status`

**Files:**
- Modify: `src/server.ts` (`buildHttpApp` gains an `activity` param; record after auth)
- Modify: `src/dashboard/api.ts` (`ApiDeps.activity`; `GET /api/mcp-status`)
- Modify: `src/index.ts` (create activity; pass to `buildHttpApp` + `mountDashboard`)
- Test: `test/server.test.ts` (extend — `/mcp` record integration), `test/dashboard/api.test.ts` (extend — `/api/mcp-status` + add `activity` to deps)

**Interfaces:**
- Consumes: `createMcpActivity`, `toolFromBody`, `McpActivity` from Task 1.
- Produces: `buildHttpApp(makeServer, authToken, artifacts?, oauth?, activity)` (5th param, required); `ApiDeps.activity: McpActivity`; `GET /api/mcp-status` → `McpActivitySnapshot`.

- [ ] **Step 1: Write the failing tests**

Append to `test/server.test.ts`:

```ts
import { buildHttpApp } from "../src/server.js";
import { createMcpActivity } from "../src/mcpActivity.js";

test("buildHttpApp records MCP activity for an authenticated /mcp request, not for an unauthorized one", async () => {
  const activity = createMcpActivity();
  const deps = { workspace: { root: "/vault" }, engine: async function* () {}, runManager: { run: async (fn: any) => fn(new AbortController(), "r") }, eventLog: { append: async () => {} }, systemPrompt: "SYS" } as any;
  const app = buildHttpApp(() => buildMcpServer(deps), "tok", undefined, undefined, activity);
  const srv = app.listen(0);
  const port = (srv.address() as any).port;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const r1 = await fetch(`http://localhost:${port}/mcp`, { method: "POST", headers, body });
  expect(r1.status).toBe(401);
  expect(activity.snapshot().count).toBe(0);
  await fetch(`http://localhost:${port}/mcp`, { method: "POST", headers: { ...headers, authorization: "Bearer tok" }, body });
  expect(activity.snapshot().count).toBe(1);
  expect(activity.snapshot().lastTool).toBe("initialize");
  srv.close();
});
```

Append a test to `test/dashboard/api.test.ts` (the `boot()` deps object must also get `activity` — see Step 3):

```ts
test("GET /api/mcp-status requires a session and returns the activity snapshot", async () => {
  const res = await fetch(`${url}/api/mcp-status`);
  expect(res.status).toBe(401);
  const cookie = await login();
  const ok = await fetch(`${url}/api/mcp-status`, { headers: { cookie } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ lastAt: null, lastTool: null, count: 0 });
});
```

(Use the same `login()` helper the other authenticated tests in this file use; if none is factored out, log in the same way they do and pass the returned `Set-Cookie` as `cookie`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- server` then `npm test -- dashboard/api`
Expected: FAIL — `buildHttpApp` takes 4 args / `activity` missing from deps / `/api/mcp-status` returns 404.

- [ ] **Step 3: Implement**

In `src/server.ts`: add the imports and thread `activity`.

Add near the top imports:
```ts
import type { McpActivity } from "./mcpActivity.js";
import { toolFromBody } from "./mcpActivity.js";
```

Change the `buildHttpApp` signature and the `/mcp` handler. Replace:
```ts
export function buildHttpApp(makeServer: () => McpServer, authToken: string, artifacts?: ArtifactStore, oauth?: { verify: (t: string) => boolean; resourceMetadataUrl: string }) {
```
with:
```ts
export function buildHttpApp(makeServer: () => McpServer, authToken: string, artifacts: ArtifactStore | undefined, oauth: { verify: (t: string) => boolean; resourceMetadataUrl: string } | undefined, activity: McpActivity) {
```
and inside `app.post("/mcp", …)`, immediately after the auth block that `return`s on failure, add the record line:
```ts
    // auth passed
    activity.record(toolFromBody(req.body));
    const server = makeServer();
```
(record BEFORE the `try` so it counts even if MCP handling later errors.)

In `src/dashboard/api.ts`: add to the `ApiDeps` interface:
```ts
  /** In-memory recorder of the most recent authenticated MCP request. */
  activity: import("../mcpActivity.js").McpActivity;
```
and add a route AFTER the `router.use(requireSession(deps.sessionKey));` line (near `/connect`):
```ts
  router.get("/mcp-status", (_req, res) => { res.json(deps.activity.snapshot()); });
```
In `test/dashboard/api.test.ts` `boot()`, add `activity` to the `createApiRouter({ … })` object:
```ts
    activity: createMcpActivity(),
```
and import it at the top of that test file: `import { createMcpActivity } from "../../src/mcpActivity.js";`

In `src/index.ts`: import and create the activity, pass it to both call sites.
Add import: `import { createMcpActivity } from "./mcpActivity.js";`
Before `const app = buildHttpApp(`:
```ts
  const activity = createMcpActivity();
```
Change the `buildHttpApp(...)` call to pass `activity` as the 5th argument:
```ts
  const app = buildHttpApp(
    () => buildMcpServer(queryDeps, { secrets, artifacts, toolsDir: join(homedir(), ".geode", "tools"), docker: realDocker(), connector: realMcpConnector() }),
    config.authToken,
    artifacts,
    { verify: (t) => !!oauth.verifyAccessToken(t), resourceMetadataUrl: `${config.baseUrl}/.well-known/oauth-protected-resource` },
    activity,
  );
```
Add `activity,` to the `mountDashboard(app, { … })` deps object (anywhere in the object literal).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- server` then `npm test -- dashboard/api` then `npm test` (full backend)
Expected: PASS; full backend suite green.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/dashboard/api.ts src/index.ts test/server.test.ts test/dashboard/api.test.ts
git commit -m "feat(status): record MCP activity at /mcp; expose GET /api/mcp-status"
```

---

### Task 3: #3 papercut — dev script + clear missing-workspace error

**Files:**
- Modify: `src/config.ts` (add `ensureWorkspaceDir`)
- Modify: `src/index.ts` (call it in `main()`)
- Modify: `package.json` (add `dev` script)
- Test: `test/config.test.ts` (new)

**Interfaces:**
- Produces: `ensureWorkspaceDir(root: string, exists?: (p: string) => boolean): void`.

- [ ] **Step 1: Write the failing test** — `test/config.test.ts`

```ts
import { expect, test } from "vitest";
import { ensureWorkspaceDir } from "../src/config.js";

test("ensureWorkspaceDir throws a clear error for a missing dir and is a no-op when present", () => {
  expect(() => ensureWorkspaceDir("/nope", () => false)).toThrow(/GEODE_WORKSPACE directory does not exist/);
  expect(() => ensureWorkspaceDir("/yes", () => true)).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- config`
Expected: FAIL — `ensureWorkspaceDir` is not exported.

- [ ] **Step 3: Implement**

In `src/config.ts`, add the import and the function:
```ts
import { existsSync } from "node:fs";
```
```ts
/** Throws a clear error if the configured workspace directory does not exist (avoids a misleading `spawn git ENOENT` later). */
export function ensureWorkspaceDir(root: string, exists: (p: string) => boolean = existsSync): void {
  if (!exists(root)) {
    throw new Error(`GEODE_WORKSPACE directory does not exist: ${root} — create it or point GEODE_WORKSPACE at an existing directory.`);
  }
}
```

In `src/index.ts` `main()`, right after `const config = loadConfig();`:
```ts
  ensureWorkspaceDir(config.workspaceRoot);
```
and add `ensureWorkspaceDir` to the existing `./config.js` import.

In `package.json` `scripts`, add (keep `start` unchanged for production where env is provided directly):
```json
    "dev": "tsx --env-file=.env src/index.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- config`
Expected: PASS. Also `npm test` (full backend) still green.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/index.ts package.json test/config.test.ts
git commit -m "fix(run): dev script loads .env; clear error when GEODE_WORKSPACE dir is missing"
```

---

### Task 4: Web — `<McpStatus>` chip + `relativeTime`

**Files:**
- Create: `web/src/time.ts`, `web/src/components/McpStatus.tsx`
- Modify: `web/src/api.ts` (type + `mcpStatus()`), `web/src/components/TopBar.tsx` (render the chip), `web/src/app.css` (chip styling)
- Test: `web/src/time.test.ts`, `web/src/components/McpStatus.test.tsx`

**Interfaces:**
- Consumes: `GET /api/mcp-status` (Task 2) → `{ lastAt, lastTool, count }`.
- Produces: `relativeTime(iso: string, nowMs?: number): string`; `McpStatus` React component; `api.mcpStatus()`.

- [ ] **Step 1: Write the failing tests**

`web/src/time.test.ts`:
```ts
import { expect, test } from "vitest";
import { relativeTime } from "./time";

const now = Date.parse("2026-01-01T12:00:00Z");
test("relativeTime buckets into just now / minutes / hours / days", () => {
  expect(relativeTime("2026-01-01T11:59:59Z", now)).toBe("just now");
  expect(relativeTime("2026-01-01T11:58:00Z", now)).toBe("2m ago");
  expect(relativeTime("2026-01-01T09:00:00Z", now)).toBe("3h ago");
  expect(relativeTime("2025-12-30T12:00:00Z", now)).toBe("2d ago");
});
```

`web/src/components/McpStatus.test.tsx`:
```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({ api: { mcpStatus: vi.fn() } }));
import { McpStatus } from "./McpStatus";
import { api } from "../api";

afterEach(cleanup);

test("shows 'no calls yet' when there is no activity", async () => {
  vi.mocked(api.mcpStatus).mockResolvedValue({ lastAt: null, lastTool: null, count: 0 });
  render(<McpStatus />);
  expect(await screen.findByText(/no calls yet/i)).toBeTruthy();
});

test("shows a relative time and the tool when there is activity", async () => {
  vi.mocked(api.mcpStatus).mockResolvedValue({ lastAt: new Date().toISOString(), lastTool: "query", count: 3 });
  render(<McpStatus />);
  const chip = await screen.findByText(/MCP ·/);
  expect(chip.textContent).toContain("query");
});

test("renders nothing when the fetch rejects (defensive)", async () => {
  vi.mocked(api.mcpStatus).mockRejectedValue(new Error("500"));
  const { container } = render(<McpStatus />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector(".chip.mcp")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- time McpStatus`
Expected: FAIL — modules `./time` / `./McpStatus` not found.

- [ ] **Step 3: Implement**

`web/src/time.ts`:
```ts
/** Formats an ISO timestamp as a short relative time: "just now", "2m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const delta = nowMs - new Date(iso).getTime();
  if (!isFinite(delta) || delta < 0) return "just now";
  const s = Math.floor(delta / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

`web/src/api.ts` — add the type near the other interfaces:
```ts
/** The kernel's most recent MCP activity since it started. */
export interface McpStatus { lastAt: string | null; lastTool: string | null; count: number }
```
and add to the `api` object (next to `connect`):
```ts
  mcpStatus: () => json<McpStatus>("/api/mcp-status"),
```

`web/src/components/McpStatus.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api, type McpStatus as McpStatusData } from "../api";
import { relativeTime } from "../time";

/** Top-bar chip showing the kernel's most recent MCP activity (or "no calls yet"). Polls every ~10s; renders nothing on missing/failed fetch. */
export function McpStatus() {
  const [s, setS] = useState<McpStatusData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { api.mcpStatus?.().then((d) => { if (alive) setS(d); }).catch(() => {}); };
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!s) return null;
  if (s.lastAt === null) return <span className="chip mcp muted" title="No MCP calls since this kernel started">MCP · no calls yet</span>;
  return (
    <span className="chip mcp live" title={`${s.count} MCP call${s.count === 1 ? "" : "s"} since start`}>
      MCP · {relativeTime(s.lastAt)}{s.lastTool ? ` · ${s.lastTool}` : ""}
    </span>
  );
}
```

`web/src/components/TopBar.tsx` — import and render the chip first in `.tb-right`:
Add to imports: `import { McpStatus } from "./McpStatus";`
Change the `<div className="tb-right">` opening so its first child is `<McpStatus />`:
```tsx
      <div className="tb-right">
        <McpStatus />
        <button className={`pill${view === "Connect" ? " active" : ""}`} onClick={() => onNav("Connect")} title="Connect a client"><ConnectIcon /> Connect</button>
```
(leave the rest of `.tb-right` unchanged.)

`web/src/app.css` — append (reuses the existing `.chip` base from the top bar):
```css
.chip.mcp{gap:7px;}
.chip.mcp.muted{color:var(--faint);}
.chip.mcp.live{color:var(--emerald-300);border-color:rgba(52,211,153,.4);}
.chip.mcp.live::before{content:"";width:6px;height:6px;border-radius:999px;background:var(--green);box-shadow:0 0 0 3px rgba(52,211,153,.18);}
```

- [ ] **Step 4: Run tests, typecheck, build**

Run: `cd web && npm test && npm run typecheck && npm run build`
Expected: all web tests PASS (incl. the 3 new + existing TopBar tests unaffected — `<McpStatus>` renders `null` when its fetch fails/isn't mocked); `tsc` clean; build OK.

- [ ] **Step 5: Commit**

```bash
git add web/src/time.ts web/src/time.test.ts web/src/components/McpStatus.tsx web/src/components/McpStatus.test.tsx web/src/api.ts web/src/components/TopBar.tsx web/src/app.css
git commit -m "feat(status): top-bar MCP activity chip + relativeTime helper"
```

---

### Task 5: Live validation

**Files:** none.

- [ ] **Step 1: Full suites** — `npm test` (root) green; `cd web && npm test && npm run typecheck` green.
- [ ] **Step 2: Build + run** — `cd web && npm run build && cd ..`, then `GEODE_PORT=8788 npx tsx --env-file=/Users/robbertvermeulen/Projects/geodemcp-2/.env src/index.ts`. Open `http://localhost:8788/` → login. Top bar shows **"MCP · no calls yet"**.
- [ ] **Step 3: Trigger activity** — with the kernel's token, `curl -s -X POST http://localhost:8788/mcp -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`. Within ~10s the chip flips to **"MCP · just now · tools/list"**.
- [ ] **Step 4: #3 check** — stop the kernel; start it with `GEODE_WORKSPACE=/tmp/does-not-exist-xyz` → it exits with **"GEODE_WORKSPACE directory does not exist: …"** (not `spawn git ENOENT`). Stop the validation kernel.

---

## Self-Review

- **Spec coverage:** activity recorder (Task 1) ✓; record at `/mcp` after auth (Task 2) ✓; session-guarded `/api/mcp-status` (Task 2) ✓; index wiring (Task 2) ✓; defensive polling chip + relative time in top bar (Task 4) ✓; #3 dev script + clear missing-workspace error (Task 3) ✓; deferred (c)/(a) intentionally absent. Testing bullets map to Tasks 1–4; live validation = Task 5.
- **Placeholder scan:** none — all code/commands literal. (`<token>` in live validation is a real value the runner copies from the Connect page.)
- **Type consistency:** `McpActivitySnapshot`/`McpActivity`/`createMcpActivity`/`toolFromBody` (Task 1) used verbatim in Task 2; `buildHttpApp(…, activity)` 5th param consistent across server.ts + index.ts + test; `ApiDeps.activity` consistent with the dashboard test deps + `/api/mcp-status`; web `McpStatus` type mirrors the snapshot; `api.mcpStatus()` name consistent across api.ts, the component, and its test.

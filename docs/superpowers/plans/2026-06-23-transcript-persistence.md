# Server-Side Chat Transcript Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each dashboard chat run server-side as JSONL so the chat timeline is identical in every browser window; the client rebuilds the timeline from the server on load.

**Architecture:** A machine-local `TranscriptStore` (JSONL at `~/.geode/transcripts/transcript.jsonl`) records one `TranscriptRecord` per `/api/query` run, captured in the SSE `stream` helper. `GET /api/history` returns all records; `DELETE /api/history` clears them. The client loads history on mount and rebuilds the timeline with the same `applyProgress`/`applyResult` reducer used live, so `localStorage` is no longer the source of truth.

**Tech Stack:** TypeScript (NodeNext ESM), Express v5, vitest; React 18 + Vite SPA. Reuses `ProgressEvent`/`Metrics`/`QueryResult` from `src/engine.ts` / `src/query.ts`.

**Spec:** `docs/superpowers/specs/2026-06-23-transcript-persistence-design.md`

---

## File Structure

- Create: `src/transcripts.ts` — `TranscriptStore` interface + JSONL `createTranscriptStore`
- Create: `test/transcripts.test.ts`
- Create: `web/src/timeline.ts` — extracted pure timeline model + reducers + `buildFromHistory`
- Create: `web/src/timeline.test.ts`
- Modify: `src/config.ts` — add `transcriptsDir`
- Modify: `src/dashboard/api.ts` — `ApiDeps.transcripts`; generalize `stream`; record `/query`; `GET`/`DELETE /history`
- Modify: `src/index.ts` — create store, pass into `mountDashboard`
- Modify: `web/src/api.ts` — `history()` + `clearHistory()` + `TranscriptRecord` type
- Modify: `web/src/components/Chat.tsx` — import timeline model; load history on mount; `Clear`→`clearHistory`; drop `localStorage`
- Modify: `test/dashboard/api.test.ts` — history round-trip + clear

---

## Task 1: TranscriptStore (JSONL)

**Files:**
- Create: `src/transcripts.ts`
- Test: `test/transcripts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/transcripts.test.ts
import { expect, test } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptStore, type TranscriptRecord } from "../src/transcripts.js";

const rec = (over: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
  runId: "r1", ts: 1000, instruction: "do X",
  events: [{ type: "text", text: "hi" } as any],
  result: { text: "done" }, ...over,
});

test("append then list round-trips records in order; dir is created lazily", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "geode-tx-")), "nested"); // not yet created
  const store = createTranscriptStore(dir);
  await store.append(rec({ runId: "r1" }));
  await store.append(rec({ runId: "r2", error: "boom", result: undefined }));
  const all = await store.list();
  expect(all.map((r) => r.runId)).toEqual(["r1", "r2"]);
  expect(all[1].error).toBe("boom");
  rmSync(dir, { recursive: true, force: true });
});

test("list on a missing file returns []", async () => {
  const store = createTranscriptStore(join(tmpdir(), "geode-tx-missing-" + Math.random().toString(36).slice(2)));
  expect(await store.list()).toEqual([]);
});

test("clear empties the thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-tx-"));
  const store = createTranscriptStore(dir);
  await store.append(rec());
  await store.clear();
  expect(await store.list()).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("a corrupt line is skipped, not thrown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-tx-"));
  const store = createTranscriptStore(dir);
  await store.append(rec({ runId: "good" }));
  appendFileSync(join(dir, "transcript.jsonl"), "{ this is not json\n");
  const all = await store.list();
  expect(all.map((r) => r.runId)).toEqual(["good"]);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/transcripts.test.ts`
Expected: FAIL — `createTranscriptStore` not found.

- [ ] **Step 3: Implement `src/transcripts.ts`**

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProgressEvent, Metrics } from "./engine.js";

export interface TranscriptRecord {
  runId: string;
  ts: number;                 // server time (ms epoch) when written
  instruction: string;
  events: ProgressEvent[];
  result?: { text: string; metrics?: Metrics };
  error?: string;
}

export interface TranscriptStore {
  append(record: TranscriptRecord): Promise<void>;
  list(): Promise<TranscriptRecord[]>;
  clear(): Promise<void>;
}

// JSONL, one record per line. Machine-local; not in the vault git. Runs are serialized by the
// runManager queue, so synchronous appends never interleave (mirrors eventLog.ts).
export function createTranscriptStore(dir: string): TranscriptStore {
  const file = join(dir, "transcript.jsonl");
  const ensureDir = () => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); };
  return {
    async append(record) {
      ensureDir();
      appendFileSync(file, JSON.stringify(record) + "\n");
    },
    async list() {
      if (!existsSync(file)) return [];
      const out: TranscriptRecord[] = [];
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as TranscriptRecord); } catch { /* skip a half-written / corrupt line */ }
      }
      return out;
    },
    async clear() {
      ensureDir();
      writeFileSync(file, "");
    },
  };
}
```

(`dirname` import is unused — omit it; shown only to flag: do not import unused names.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/transcripts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/transcripts.ts test/transcripts.test.ts
git commit -m "feat(transcripts): JSONL TranscriptStore (append/list/clear)"
```

---

## Task 2: Config — `transcriptsDir`

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add the field and default**

In `src/config.ts`, add to the `Config` interface (after `artifactsDir: string;`):

```ts
  transcriptsDir: string;
```

In `loadConfig`'s returned object (after the `artifactsDir:` line), add:

```ts
    transcriptsDir: env.GEODE_TRANSCRIPTS_DIR || join(homedir(), ".geode", "transcripts"),
```

`homedir` and `join` are already imported.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (No config unit test exists; the field is exercised in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add transcriptsDir (GEODE_TRANSCRIPTS_DIR, default ~/.geode/transcripts)"
```

---

## Task 3: API — record runs + history routes

**Files:**
- Modify: `src/dashboard/api.ts`
- Test: `test/dashboard/api.test.ts`

- [ ] **Step 1: Write the failing test** (add to `test/dashboard/api.test.ts`)

First, extend the fake `runQuery` in `boot()` to emit events and return a runId. Replace the existing
`runQuery` line in the `createApiRouter({...})` call with:

```ts
    runQuery: async (instruction, onProgress) => {
      onProgress({ type: "tool", toolId: "t1", name: "Write", summary: "note.md", detail: "x" } as any);
      onProgress({ type: "tool_result", toolId: "t1", ok: true, output: "ok" } as any);
      writeFileSync(join(root, "note.md"), "x");
      return { runId: "run-xyz", text: "ok: " + instruction, commit: null, filesTouched: ["note.md"] };
    },
```

Add `transcripts` to the same `createApiRouter({...})` deps using a real store in a temp dir:

```ts
    transcripts: createTranscriptStore(join(root, ".transcripts")),
```

Add the import at the top of the test file:

```ts
import { createTranscriptStore } from "../../src/transcripts.js";
```

Then add this test:

```ts
test("records each query run and serves it via GET /api/history; DELETE clears it", async () => {
  const cookie = await login();
  await fetch(`${url}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "do X" }) }).then((r) => r.text());
  const hist = await (await fetch(`${url}/api/history`, { headers: { cookie } })).json();
  expect(hist).toHaveLength(1);
  expect(hist[0]).toMatchObject({ runId: "run-xyz", instruction: "do X", result: { text: "ok: do X" } });
  expect(hist[0].events.map((e: any) => e.type)).toEqual(["tool", "tool_result"]);
  const del = await fetch(`${url}/api/history`, { method: "DELETE", headers: { cookie } });
  expect((await del.json()).ok).toBe(true);
  expect(await (await fetch(`${url}/api/history`, { headers: { cookie } })).json()).toEqual([]);
});

test("GET /api/history requires a session", async () => {
  expect((await fetch(`${url}/api/history`)).status).toBe(401);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/dashboard/api.test.ts`
Expected: FAIL — `transcripts` not a valid dep / `/api/history` 404.

- [ ] **Step 3: Implement in `src/dashboard/api.ts`**

Add the import (top of file, with the other type imports):

```ts
import { randomUUID } from "node:crypto";
import type { TranscriptStore, TranscriptRecord } from "../transcripts.js";
```

Note: `node:crypto` is already imported for `timingSafeEqual` — extend that import instead:
`import { timingSafeEqual, randomUUID } from "node:crypto";`

Add to the `ApiDeps` interface:

```ts
  transcripts: TranscriptStore;
```

Replace the `stream` helper with the recording-capable version:

```ts
  const stream = (
    run: (op: (event: ProgressEvent) => void) => Promise<QueryResult>,
    onDone?: (events: ProgressEvent[], outcome: { result: QueryResult } | { error: string }) => Promise<void>,
  ) => async (_req: Request, res: Response) => {
    const sse = openSse(res);
    const events: ProgressEvent[] = [];
    try {
      const result = await run((event) => { events.push(event); sse.send("progress", event); });
      sse.send("result", result);
      try { await onDone?.(events, { result }); } catch (e) { console.error("transcript append failed:", e); }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sse.send("error", { message });
      try { await onDone?.(events, { error: message }); } catch (err) { console.error("transcript append failed:", err); }
    } finally {
      sse.close();
    }
  };
```

Replace the `/query` route with the recording version (leave `/remember` unchanged):

```ts
  router.post("/query", (req, res) => {
    const instruction = String(req.body?.instruction ?? "");
    stream(
      (op) => deps.runQuery(instruction, op),
      async (events, outcome) => {
        const rec: TranscriptRecord = "result" in outcome
          ? { runId: outcome.result.runId, ts: Date.now(), instruction, events, result: { text: outcome.result.text, metrics: outcome.result.metrics } }
          : { runId: randomUUID(), ts: Date.now(), instruction, events, error: outcome.error };
        await deps.transcripts.append(rec);
      },
    )(req, res);
  });
```

Add the two history routes after the `/discard` route (they sit below `router.use(requireSession(...))`, so they are already guarded):

```ts
  router.get("/history", async (_req, res) => { res.json(await deps.transcripts.list()); });
  router.delete("/history", async (_req, res) => { await deps.transcripts.clear(); res.json({ ok: true }); });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dashboard/api.test.ts`
Expected: PASS (all, including the existing SSE/login/file tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/api.ts test/dashboard/api.test.ts
git commit -m "feat(dashboard): record query runs to TranscriptStore; GET/DELETE /api/history"
```

---

## Task 4: Wire the store in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Create and inject the store**

Add the import (with the other src imports):

```ts
import { createTranscriptStore } from "./transcripts.js";
```

Inside `main()`, after the `artifacts` store is created (before `queryDeps`), add:

```ts
  const transcripts = createTranscriptStore(config.transcriptsDir);
```

In the `mountDashboard(app, { ... })` deps object, add the field (e.g. after `artifactsDir:`):

```ts
      transcripts,
```

- [ ] **Step 2: Typecheck + full backend suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(kernel): wire TranscriptStore into the dashboard"
```

---

## Task 5: Client API — `history()` + `clearHistory()`

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add the type and calls**

Add the type near `SseEvent` (events kept loose, matching `SseEvent.data: any`):

```ts
export interface TranscriptRecord {
  runId: string;
  ts: number;
  instruction: string;
  events: any[];
  result?: { text: string; metrics?: { durationMs: number; costUsd: number; tokens: number } };
  error?: string;
}
```

Add to the `api` object (e.g. after `discard`):

```ts
  history: () => json<TranscriptRecord[]>("/api/history"),
  clearHistory: () => json<{ ok: true }>("/api/history", { method: "DELETE" }),
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(web): api.history() + api.clearHistory()"
```

---

## Task 6: Extract timeline model + `buildFromHistory` (with tests)

**Files:**
- Create: `web/src/timeline.ts`
- Test: `web/src/timeline.test.ts`
- Modify: `web/src/components/Chat.tsx` (import from timeline.ts)

This extracts the pure model + reducers currently inside `Chat.tsx` into a testable module and adds
`buildFromHistory`. **Move** (cut from `Chat.tsx`, paste into `timeline.ts`) these exact items: the
`Step`, `Metrics`, `Item` types, `applyProgress`, `applyResult`. Then add `buildFromHistory`.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/timeline.test.ts
import { expect, test } from "vitest";
import { buildFromHistory } from "./timeline";

test("rebuilds a successful run into user → activity(done step) → agent(meta)", () => {
  const items = buildFromHistory([{
    runId: "r1", ts: 1000, instruction: "do X",
    events: [
      { type: "tool", toolId: "t1", name: "Write", summary: "note.md", detail: "x" },
      { type: "tool_result", toolId: "t1", ok: true, output: "ok" },
    ],
    result: { text: "done", metrics: { durationMs: 1200, costUsd: 0.01, tokens: 50 } },
  }]);
  expect(items.map((i) => i.kind)).toEqual(["user", "activity", "agent"]);
  const activity = items[1] as any;
  expect(activity.steps[0]).toMatchObject({ name: "Write", running: false, ok: true });
  expect((items[2] as any).meta.tokens).toBe(50);
});

test("rebuilds a failed run into user → …events… → error", () => {
  const items = buildFromHistory([{
    runId: "r2", ts: 2000, instruction: "do Y",
    events: [{ type: "thinking", text: "hmm" }],
    error: "boom",
  }]);
  expect(items.map((i) => i.kind)).toEqual(["user", "thinking", "error"]);
  expect((items[2] as any).text).toBe("boom");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/timeline.test.ts`
Expected: FAIL — `timeline` module / `buildFromHistory` not found.

- [ ] **Step 3: Create `web/src/timeline.ts`**

Move the types + reducers out of `Chat.tsx` and add `buildFromHistory`. Full module:

```ts
import type { TranscriptRecord } from "./api";

export type Step = { toolId: string; name: string; summary?: string; detail?: string; output?: string; running?: boolean; ok?: boolean };
export type Metrics = { durationMs: number; costUsd: number; tokens: number };
export type Item =
  | { kind: "user"; text: string; ts: number }
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "activity"; steps: Step[]; ts: number }
  | { kind: "todos"; items: { content: string; status: string }[]; ts: number }
  | { kind: "notice"; noticeKind: "compact" | "memory" | "retry"; text: string; ts: number }
  | { kind: "agent"; text: string; ts: number; animate?: boolean; meta?: Metrics }
  | { kind: "error"; text: string; ts: number };

export function applyProgress(items: Item[], ev: any, ts: number): Item[] {
  const next = items.slice();
  const last = next[next.length - 1];
  switch (ev.type) {
    case "thinking":
      next.push({ kind: "thinking", text: ev.text, ts });
      return next;
    case "tool": {
      const step: Step = { toolId: ev.toolId, name: ev.name, summary: ev.summary, detail: ev.detail, running: true };
      if (last && last.kind === "activity") next[next.length - 1] = { ...last, steps: [...last.steps, step] };
      else next.push({ kind: "activity", steps: [step], ts });
      return next;
    }
    case "tool_result": {
      for (let i = next.length - 1; i >= 0; i--) {
        const it = next[i];
        if (it.kind === "activity") {
          const idx = it.steps.findIndex((s) => s.toolId === ev.toolId && s.running);
          if (idx >= 0) {
            const steps = it.steps.slice();
            steps[idx] = { ...steps[idx], running: false, ok: ev.ok, output: ev.output };
            next[i] = { ...it, steps };
            return next;
          }
        }
      }
      return next;
    }
    case "todos": {
      let userIdx = -1;
      for (let i = next.length - 1; i >= 0; i--) if (next[i].kind === "user") { userIdx = i; break; }
      for (let i = next.length - 1; i > userIdx; i--) if (next[i].kind === "todos") { next[i] = { kind: "todos", items: ev.items, ts }; return next; }
      next.push({ kind: "todos", items: ev.items, ts });
      return next;
    }
    case "notice":
      next.push({ kind: "notice", noticeKind: ev.kind, text: ev.text, ts });
      return next;
    case "text":
      next.push({ kind: "agent", text: ev.text, ts, animate: true });
      return next;
    default:
      return next;
  }
}

export function applyResult(items: Item[], data: any, ts: number): Item[] {
  const text = (data.text || "").trim();
  const meta: Metrics | undefined = data.metrics;
  const next = items.map((it) => (it.kind === "activity" && it.steps.some((s) => s.running)
    ? { ...it, steps: it.steps.map((s) => (s.running ? { ...s, running: false } : s)) } : it));
  let lastAgent = -1;
  for (let i = next.length - 1; i >= 0; i--) if (next[i].kind === "agent") { lastAgent = i; break; }
  if (text && (lastAgent < 0 || (next[lastAgent] as any).text.trim() !== text)) {
    next.push({ kind: "agent", text, ts, animate: true, meta });
  } else if (lastAgent >= 0 && meta) {
    next[lastAgent] = { ...(next[lastAgent] as any), meta };
  }
  return next;
}

// Rebuild the full timeline from server-stored records. Each item in a run shares the record ts; the
// final answer/steps render statically (animate stripped, running cleared) — same as a persisted reload.
export function buildFromHistory(records: TranscriptRecord[]): Item[] {
  let items: Item[] = [];
  for (const rec of records) {
    items.push({ kind: "user", text: rec.instruction, ts: rec.ts });
    for (const ev of rec.events) items = applyProgress(items, ev, rec.ts);
    if (rec.result) items = applyResult(items, rec.result, rec.ts);
    else if (rec.error) items.push({ kind: "error", text: rec.error, ts: rec.ts });
  }
  return items.map((it) => (it.kind === "agent" ? { ...it, animate: false } : it));
}
```

- [ ] **Step 4: Update `Chat.tsx` to import from timeline.ts**

In `web/src/components/Chat.tsx`: delete the now-moved `Step`/`Metrics`/`Item` type declarations and the
`applyProgress`/`applyResult` function bodies, and import them instead:

```ts
import { applyProgress, applyResult, buildFromHistory, type Item, type Metrics, type Step } from "../timeline";
```

(`Step` may be unused in Chat.tsx after the move — if so, drop it from the import. `Metrics` is used by
`AgentBubble`'s prop type; keep it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/timeline.test.ts && npx tsc -b`
Expected: PASS (2 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/timeline.ts web/src/timeline.test.ts web/src/components/Chat.tsx
git commit -m "refactor(web): extract timeline model + buildFromHistory (tested)"
```

---

## Task 7: Chat loads history on mount; Clear wipes server-side

**Files:**
- Modify: `web/src/components/Chat.tsx`

- [ ] **Step 1: Replace localStorage with server history**

In `Chat.tsx`:

1. Delete the `STORE` const, the `loadMsgs` helper, and the `useEffect` that writes `localStorage`.
2. Initialize empty and load from the server on mount:

```ts
  const [msgs, setMsgs] = useState<Item[]>([]);
  useEffect(() => { api.history().then((h) => setMsgs(buildFromHistory(h))).catch(() => {}); }, []);
```

3. Add the `api` import: `import { api, type SseEvent } from "../api";` (replace the existing
   `import type { SseEvent } from "../api";`).
4. Change the `Clear` button handler from `onClick={() => setMsgs([])}` to:

```tsx
onClick={() => { api.clearHistory().catch(() => {}); setMsgs([]); }}
```

The live `submit` path (building items from the SSE stream) is unchanged — the server records the same
run in parallel, so no refetch is needed after a run.

- [ ] **Step 2: Build the SPA**

Run: `cd web && npm run build`
Expected: `tsc -b` clean; vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Chat.tsx
git commit -m "feat(web): load chat history from server on mount; Clear wipes it"
```

---

## Task 8: Live validation

**Files:** none (manual verification against the demo kernel)

- [ ] **Step 1: Restart the demo kernel** (backend changed → tsx does not hot-reload)

```bash
lsof -nP -iTCP:8794 -sTCP:LISTEN -t | xargs kill 2>/dev/null
GEODE_WORKSPACE=/tmp/geode-ctx-demo GEODE_AUTH_TOKEN=t GEODE_BASE_URL=http://localhost:8794 \
GEODE_SECRETS_DIR=/tmp/geode-ctx-sec GEODE_DASHBOARD_PASSWORD=pw GEODE_PORT=8794 \
nohup npx tsx src/index.ts >/tmp/geode-demo.log 2>&1 & disown
```

- [ ] **Step 2: Verify** (Playwright or manual)
  - Run a query → it streams + renders as before.
  - `GET /api/history` (with the session cookie) returns the run as a record.
  - Reload in a **fresh** browser/incognito window → the chat history appears (rebuilt from the server).
  - `Clear` → history empties; reload → still empty.
  - Confirm `~/.geode/transcripts/transcript.jsonl` exists (demo uses `/tmp/geode-ctx-sec`-style dirs; the
    transcripts dir defaults to `~/.geode/transcripts` unless `GEODE_TRANSCRIPTS_DIR` is set — set it for
    the demo if you want it under `/tmp`).

---

## Self-Review

- **Spec coverage:** store (T1), config/path (T2), capture + history routes (T3), wiring (T4), client API
  (T5), rebuild reducer (T6), load-on-mount + server-side Clear (T7), live check (T8). All spec sections
  mapped.
- **Types:** `TranscriptRecord` defined once server-side (T1) and mirrored loosely client-side (T5);
  `ProgressEvent`/`Metrics`/`QueryResult` reused, not redefined. `applyProgress`/`applyResult` signatures
  match the originals moved from `Chat.tsx`.
- **No placeholders:** every code step is complete.
- **Note:** Task 6 moves code out of `Chat.tsx`; the implementer must delete the originals there to avoid
  duplicate declarations (TypeScript will error if both exist — a built-in safety net).

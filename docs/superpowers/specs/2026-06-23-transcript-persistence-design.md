# Server-Side Chat Transcript Persistence — Design

**Status:** approved decisions, pending spec review
**Date:** 2026-06-23
**Builds on:** the structured chat timeline (`feat/dashboard-context`, commit `0716994`)

## Problem

The dashboard chat timeline is rebuilt from streamed `ProgressEvent`s and persisted **only in the
browser's `localStorage`**. Open the dashboard in another browser / profile / incognito window and the
chat history is empty — while vault files (server-side, git-backed) show everywhere. We want the chat
history to live on the server so it is the same in every window.

## Decisions (locked)

1. **Storage:** machine-local, **outside the vault git** — `~/.geode/transcripts/` (sibling of
   `secrets/`). Full timelines carry tool output and file snippets; they are operational data, not
   curated context, and must not pollute the knowledge git.
2. **Model:** **one continuous thread** (server-side mirror of today's UX). `Clear` wipes it.

## Non-goals (explicit)

- Multiple/named conversations or a session sidebar. (Single thread only.)
- Live cross-window sync. A second window sees new runs **after a reload** — same contract as vault files.
- Persisting `/remember` runs into the chat thread. The chat UI only calls `/api/query`; only query runs
  are recorded. (`remember` keeps its existing `log.md` / MCP trail.)
- Retention caps / rotation. Keep everything; `Clear` is the only delete. (Note left for a future pass.)
- Per-user partitioning. Single dashboard password = single thread.

## Architecture

```
POST /api/query ──► runQuery (stream ProgressEvents) ──► SSE to client (live render)
                         │
                         └──► accumulate events ──► on completion ──► TranscriptStore.append(record)

GET  /api/history ──► TranscriptStore.list()  ──► client rebuilds timeline on mount
DELETE /api/history ─► TranscriptStore.clear() ◄── chat "Clear" button
```

Source of truth = server. The client renders live from the SSE stream during a run (unchanged) **and**
the server records that same run in parallel. On mount the client loads `/api/history` and rebuilds the
timeline with the *same* `applyProgress`/`applyResult` reducer used live (DRY — no second renderer).

### Data model

A record = one query run. The conversation = the ordered list of records.

```ts
// src/transcripts.ts
import type { ProgressEvent, Metrics } from "./engine.js";

export interface TranscriptRecord {
  runId: string;
  ts: number;                 // server time (ms epoch) when the record was written
  instruction: string;        // the user's prompt for this run
  events: ProgressEvent[];    // every non-result event, in order
  result?: { text: string; metrics?: Metrics };  // present on success
  error?: string;             // present when the run threw
}
```

`ProgressEvent` and `Metrics` are reused verbatim from `src/engine.ts` — the wire format the client
already understands. No new event schema.

### Store (`src/transcripts.ts`)

JSONL, one record per line, in a machine-local dir. Mirrors `eventLog.ts`'s shape (factory + injectable
clock) for testability.

```ts
export interface TranscriptStore {
  append(record: TranscriptRecord): Promise<void>;
  list(): Promise<TranscriptRecord[]>;
  clear(): Promise<void>;
}

export function createTranscriptStore(dir: string): TranscriptStore;
```

- `append`: `mkdirSync(dir, {recursive:true})` once; `appendFileSync(file, JSON.stringify(record) + "\n")`.
- `list`: if file missing → `[]`; else read, split on `\n`, drop blanks, `JSON.parse` each line inside a
  try/catch (skip a corrupt line rather than throw — a half-written line must not break history).
- `clear`: `writeFileSync(file, "")` (truncate). File: `join(dir, "transcript.jsonl")`.

Synchronous fs is fine: runs are serialized by the `runManager` (queue), so appends never interleave;
this matches `eventLog.ts`.

### Capture point (`src/dashboard/api.ts`)

Generalize the existing `stream` helper to optionally record. The SSE behavior is unchanged; recording is
an extra step that accumulates the events it already forwards.

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
    await onDone?.(events, { result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sse.send("error", { message });
    await onDone?.(events, { error: message });
  } finally {
    sse.close();
  }
};
```

Routes:

```ts
router.post("/query", (req, res) => {
  const instruction = String(req.body?.instruction ?? "");
  stream(
    (op) => deps.runQuery(instruction, op),
    async (events, outcome) => {
      const rec: TranscriptRecord = "result" in outcome
        ? { runId: outcome.result.runId, ts: Date.now(), instruction, events,
            result: { text: outcome.result.text, metrics: outcome.result.metrics } }
        : { runId: randomUUID(), ts: Date.now(), instruction, events, error: outcome.error };
      await deps.transcripts.append(rec);
    },
  )(req, res);
});

// /remember keeps the plain stream(...) with no onDone — not part of the chat thread.

router.get("/history", async (_req, res) => { res.json(await deps.transcripts.list()); });
router.delete("/history", async (_req, res) => { await deps.transcripts.clear(); res.json({ ok: true }); });
```

`randomUUID` from `node:crypto` for the error-case id (a thrown run has no `QueryResult`). Both routes
sit behind the existing `requireSession` guard.

`ApiDeps` gains: `transcripts: TranscriptStore`.

### Wiring (`src/config.ts`, `src/index.ts`, `src/dashboard/index.ts`)

- `config.ts`: add `transcriptsDir: string`, default `join(homedir(), ".geode", "transcripts")`, env
  `GEODE_TRANSCRIPTS_DIR`.
- `index.ts`: `const transcripts = createTranscriptStore(config.transcriptsDir);` passed into
  `mountDashboard` deps.
- `dashboard/index.ts`: `DashboardDeps extends ApiDeps` already forwards new fields; no logic change.

### Client (`web/src/api.ts`, `web/src/components/Chat.tsx`)

`api.ts` — add the two calls and a loose `TranscriptRecord` type (events typed as `any[]`, matching the
existing loose `SseEvent.data`):

```ts
history: () => json<TranscriptRecord[]>("/api/history"),
clearHistory: () => json<{ ok: true }>("/api/history", { method: "DELETE" }),
```

`Chat.tsx`:
- **Remove** `localStorage` as the source of truth (drop `STORE` load/save). The server is authoritative.
- **On mount:** `api.history()` → `buildFromHistory(records)` → `setMsgs(...)`. Rebuild folds each record:
  1. push `{ kind: "user", text: record.instruction, ts: record.ts }`
  2. `events.reduce((items, ev) => applyProgress(items, ev, record.ts), items)`
  3. if `record.result`: `applyResult(items, record.result, record.ts)`;
     else if `record.error`: push `{ kind: "error", text: record.error, ts: record.ts }`
  All items in a run share `record.ts` (coarser than live per-item stamps — acceptable; the live path
  keeps per-item `Date.now()`).
- **Clear button:** `await api.clearHistory(); setMsgs([]);`
- Live run path is unchanged (still builds items from the SSE stream as it arrives). No refetch after a
  run — the locally-built items already match what the server stored.

`buildFromHistory`, `applyProgress`, `applyResult` are pure → unit-testable without a DOM.

## Error handling

- A thrown run is still recorded (events streamed so far + `error`), so a failed run replays as
  user-prompt → partial steps → red error banner.
- Corrupt/half-written JSONL lines are skipped on `list`, never throw.
- `history()` failing on mount (e.g. store dir unwritable) → log to console, start with an empty timeline;
  the dashboard stays usable. Recording failures in `onDone` are caught and logged, never break the SSE
  response the user is watching.

## Testing

- `test/transcripts.test.ts`: append→list round-trips records; `clear` empties; a corrupt line is skipped;
  the dir is created on first append.
- `test/dashboard/api.test.ts`: extend the fake `runQuery` to emit a couple of events + return a `runId`;
  assert `POST /api/query` then `GET /api/history` returns one record with `instruction`, the events, and
  `result`; `DELETE /api/history` then `GET` returns `[]`. Both require the session cookie.
- `web` unit test for `buildFromHistory`: a record with `[tool, tool_result, text]` + result rebuilds to
  `[user, activity(1 step, not running, ok), agent(meta)]`; an `error` record rebuilds to
  `[user, …events…, error]`.

## Files touched

| File | Change |
|------|--------|
| `src/transcripts.ts` | **new** — `TranscriptStore` + JSONL `createTranscriptStore` |
| `src/config.ts` | add `transcriptsDir` (env `GEODE_TRANSCRIPTS_DIR`, default `~/.geode/transcripts`) |
| `src/index.ts` | create the store, pass into `mountDashboard` |
| `src/dashboard/api.ts` | `ApiDeps.transcripts`; generalize `stream` with `onDone`; record `/query`; add `GET`/`DELETE /history` |
| `web/src/api.ts` | `history()` + `clearHistory()` + `TranscriptRecord` type |
| `web/src/components/Chat.tsx` | load history on mount + `buildFromHistory`; `Clear`→`clearHistory`; drop `localStorage` |
| `test/transcripts.test.ts` | **new** |
| `test/dashboard/api.test.ts` | history round-trip + clear |
| `web/src/components/*.test` | `buildFromHistory` rebuild test |

## Open question for review

`Clear` becomes a **destructive, server-side, irreversible** wipe of all history (vs. today's local-only
clear). Acceptable for a single-user local dashboard, but worth confirming we don't want a confirm step.
Recommendation: keep it one-click for now (matches current behavior); revisit if it bites.

# Vault Security 1B-1: Agent Engine in a Subprocess — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Claude Agent SDK run out of the trusted kernel process into a separate, ephemeral **runner subprocess** that communicates with the broker over a JSON-line pipe — establishing the process boundary (and cancellation across it) that slice 1B-1b will harden with a distinct uid.

**Architecture:** Only the `deps.engine(...)` call in `src/query.ts:118` executes agent tool calls; everything around it (retrieval, git, secrets, artifacts) already runs in the broker. So we substitute the in-process `claudeAgentEngine` for a **subprocess engine adapter** that spawns a runner entrypoint, marshals the (JSON-serializable) `EngineRunOptions` in, streams `EngineEvent`s back out, and forwards cancellation as a control message. The runner keeps the SDK sandbox (per §6.4 — no outer bwrap). This phase runs the runner under the **same uid** as the broker; the privilege drop + shared-group working tree + secrets-dir isolation are slice 1B-1b.

**Tech Stack:** Node 20, TypeScript ESM run via `tsx`, `node:child_process`, Vitest.

**Scope:** Slice 1B-1 = Layer 1 (trust split), **process-isolation phase only** (spec `docs/superpowers/specs/2026-07-20-vault-security-foundation-design.md` §2 Layer 1 + §6.4). It does NOT drop privileges, change file permissions, or split fetch/process roles (Layer 2 = slice 1B-2). After this plan, the agent runs in an isolated subprocess with a clean pipe protocol and working cancellation — same uid, so no security boundary yet, but the entire architecture and protocol are in place and tested.

## Global Constraints

- **English-only** in all code and comments. No Dutch.
- **New exports need JSDoc** or the husky pre-commit gate blocks the commit.
- **Surgical changes.** Match existing style; do not refactor adjacent code.
- **Do not change `claudeAgentEngine`'s behavior** — it becomes the code the *runner* invokes; the SDK sandbox settings, `canUseTool`, and prompt layering are unchanged.
- **`EngineRunOptions` is JSON-serializable except `abortController`** (`src/engine.ts:26-33`). The `abortController` never crosses the pipe; cancellation is a control message.
- **The runner is ephemeral:** one subprocess per run, spawned when the run starts, exits when the engine completes or is cancelled. Runs are already serialized by `runManager` (`src/runManager.ts`).
- Run `npm run typecheck` and `npm test` green before every commit.

## Existing interfaces this plan consumes (from `src/engine.ts`)

```ts
export type EngineEvent = ProgressEvent | ResultEvent;   // plain-JSON discriminated union (:12-23)
export interface EngineRunOptions {                       // (:26-33)
  instruction: string; cwd: string; systemPrompt: string;
  model?: string; abortController: AbortController; sandbox?: SandboxSettings;
}
export type Engine = (opts: EngineRunOptions) => AsyncIterable<EngineEvent>;   // (:36)
export const claudeAgentEngine: Engine = /* dynamically imports the SDK, streams events */;   // wired at src/index.ts:63
```

## File Structure

**Created:**
- `src/runner/framing.ts` — newline-delimited-JSON codec: encode one message to a line; a stateful decoder that buffers partial chunks and yields complete messages. Pure.
- `src/runner/protocol.ts` — the wire types shared by broker and runner: the job message, the event message, the control (cancel) message.
- `src/runner/runJob.ts` — the runner's core loop as a testable function `runJob(engine, io)`: read the job, run the engine, stream events, honor a cancel control message. No process/stdio coupling.
- `src/runner/main.ts` — the runner entrypoint: wires `process.stdin`/`process.stdout` + `claudeAgentEngine` into `runJob`. Thin.
- `src/subprocessEngine.ts` — `createSubprocessEngine(opts)` → an `Engine` that spawns the runner, marshals options in, yields events out, forwards `abortController` as a cancel message.
- Tests: `test/runner/framing.test.ts`, `test/runner/runJob.test.ts`, `test/subprocessEngine.test.ts`.

**Modified:**
- `src/index.ts:63` — swap `engine: claudeAgentEngine` for the subprocess engine.

---

## Task 1: Newline-delimited JSON framing codec

**Files:**
- Create: `src/runner/framing.ts`, `test/runner/framing.test.ts`

**Interfaces:**
- Produces:
  - `encodeLine(msg: unknown): string` — `JSON.stringify(msg) + "\n"`.
  - `createLineDecoder(): (chunk: string) => unknown[]` — a closure holding a buffer; each call appends the chunk, splits on `\n`, JSON-parses complete lines, retains the partial remainder, and returns the parsed messages (mirrors `web/src/api.ts` `parseSseChunk`'s buffering).

- [ ] **Step 1: Write the failing test**

```ts
// test/runner/framing.test.ts
import { describe, it, expect } from "vitest";
import { encodeLine, createLineDecoder } from "../../src/runner/framing.js";

describe("framing", () => {
  it("encodes a message as one JSON line", () => {
    expect(encodeLine({ a: 1 })).toBe('{"a":1}\n');
  });
  it("decodes complete lines and buffers a partial remainder", () => {
    const decode = createLineDecoder();
    expect(decode('{"a":1}\n{"b":2}\n{"c":')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(decode('3}\n')).toEqual([{ c: 3 }]);
  });
  it("returns nothing for an empty or whitespace-only flush", () => {
    const decode = createLineDecoder();
    expect(decode("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/runner/framing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runner/framing.ts
/** Encodes one message as a single newline-terminated JSON line. */
export function encodeLine(msg: unknown): string {
  return JSON.stringify(msg) + "\n";
}

/** Creates a stateful decoder that buffers partial input and returns complete JSON messages per chunk. */
export function createLineDecoder(): (chunk: string) => unknown[] {
  let buf = "";
  return (chunk: string) => {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    const out: unknown[] = [];
    for (const line of parts) if (line.trim()) out.push(JSON.parse(line));
    return out;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/runner/framing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner/framing.ts test/runner/framing.test.ts
git commit -m "feat(runner): newline-delimited JSON framing codec"
```

---

## Task 2: Wire protocol types

**Files:**
- Create: `src/runner/protocol.ts`

**Interfaces:**
- Consumes: `EngineEvent` from `src/engine.ts`; `SandboxSettings` from `src/agentSandbox.ts`.
- Produces:
  - `JobMessage` = `{ kind: "job" } & Omit<EngineRunOptions, "abortController">` — the serializable run options (instruction, cwd, systemPrompt, model?, sandbox?).
  - `ControlMessage` = `{ kind: "cancel" }` — broker → runner.
  - `EventMessage` = `{ kind: "event"; event: EngineEvent }` — runner → broker.
  - `DoneMessage` = `{ kind: "done" }` and `ErrorMessage` = `{ kind: "error"; message: string }` — runner → broker terminal signals.
  - `RunnerOut = EventMessage | DoneMessage | ErrorMessage`; `BrokerOut = JobMessage | ControlMessage`.

This task has no test of its own (pure types); it is verified by Tasks 3–4 compiling against it.

- [ ] **Step 1: Write the types**

```ts
// src/runner/protocol.ts
import type { EngineEvent, EngineRunOptions } from "../engine.js";

/** Broker → runner: the run to execute (EngineRunOptions minus the non-serializable abortController). */
export type JobMessage = { kind: "job" } & Omit<EngineRunOptions, "abortController">;
/** Broker → runner: cancel the in-flight run. */
export type ControlMessage = { kind: "cancel" };
/** Runner → broker: one streamed engine event. */
export type EventMessage = { kind: "event"; event: EngineEvent };
/** Runner → broker: the engine completed normally. */
export type DoneMessage = { kind: "done" };
/** Runner → broker: the engine threw; `message` is the error text. */
export type ErrorMessage = { kind: "error"; message: string };

/** Messages the broker sends to the runner over stdin. */
export type BrokerOut = JobMessage | ControlMessage;
/** Messages the runner sends to the broker over stdout. */
export type RunnerOut = EventMessage | DoneMessage | ErrorMessage;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/runner/protocol.ts
git commit -m "feat(runner): broker<->runner wire protocol types"
```

---

## Task 3: Runner core loop (`runJob`)

**Files:**
- Create: `src/runner/runJob.ts`, `test/runner/runJob.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EngineRunOptions` (`src/engine.ts`); `JobMessage`, `RunnerOut`, `BrokerOut` (`src/runner/protocol.ts`).
- Produces: `runJob(engine: Engine, io: RunnerIo): Promise<void>` where
  `RunnerIo = { onBrokerMessage: (h: (m: BrokerOut) => void) => void; send: (m: RunnerOut) => void }`.
  It waits for the `job` message, constructs an `AbortController`, invokes `engine({...job, abortController})`, sends each event as `{kind:"event"}`, sends `{kind:"done"}` at the end (or `{kind:"error"}` on throw), and calls `abortController.abort()` when a `{kind:"cancel"}` control message arrives.

- [ ] **Step 1: Write the failing test**

```ts
// test/runner/runJob.test.ts
import { describe, it, expect } from "vitest";
import { runJob, type RunnerIo } from "../../src/runner/runJob.js";
import type { Engine, EngineEvent } from "../../src/engine.js";
import type { BrokerOut, RunnerOut } from "../../src/runner/protocol.js";

/** An in-memory RunnerIo that lets the test push broker messages and capture runner output. */
function harness() {
  let handler: (m: BrokerOut) => void = () => {};
  const sent: RunnerOut[] = [];
  const io: RunnerIo = { onBrokerMessage: (h) => { handler = h; }, send: (m) => sent.push(m) };
  return { io, push: (m: BrokerOut) => handler(m), sent };
}

const job = { kind: "job", instruction: "hi", cwd: "/v", systemPrompt: "" } as const;

describe("runJob", () => {
  it("runs the engine and streams events then done", async () => {
    const engine: Engine = async function* () {
      yield { type: "text", text: "a" } as EngineEvent;
      yield { type: "result", text: "final" } as EngineEvent;
    };
    const h = harness();
    const p = runJob(engine, h.io);
    h.push(job);
    await p;
    expect(h.sent).toEqual([
      { kind: "event", event: { type: "text", text: "a" } },
      { kind: "event", event: { type: "result", text: "final" } },
      { kind: "done" },
    ]);
  });

  it("aborts the engine when a cancel control message arrives", async () => {
    let aborted = false;
    const engine: Engine = async function* (opts) {
      opts.abortController.signal.addEventListener("abort", () => { aborted = true; });
      yield { type: "text", text: "a" } as EngineEvent;
      await new Promise((r) => setTimeout(r, 5));
    };
    const h = harness();
    const p = runJob(engine, h.io);
    h.push(job);
    await new Promise((r) => setTimeout(r, 1));
    h.push({ kind: "cancel" });
    await p;
    expect(aborted).toBe(true);
  });

  it("sends an error message when the engine throws", async () => {
    const engine: Engine = async function* () { throw new Error("boom"); };
    const h = harness();
    const p = runJob(engine, h.io);
    h.push(job);
    await p;
    expect(h.sent).toEqual([{ kind: "error", message: "boom" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/runner/runJob.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runner/runJob.ts
import type { Engine } from "../engine.js";
import type { BrokerOut, RunnerOut } from "./protocol.js";

/** The runner's transport seam: subscribe to broker messages, and send messages back. */
export interface RunnerIo {
  onBrokerMessage: (handler: (m: BrokerOut) => void) => void;
  send: (m: RunnerOut) => void;
}

/** Waits for the job, runs the engine streaming events, honors a cancel control message, and signals done/error. */
export async function runJob(engine: Engine, io: RunnerIo): Promise<void> {
  const abortController = new AbortController();
  const job = await new Promise<Extract<BrokerOut, { kind: "job" }>>((resolve) => {
    io.onBrokerMessage((m) => {
      if (m.kind === "job") resolve(m);
      else if (m.kind === "cancel") abortController.abort();
    });
  });
  try {
    const { kind: _kind, ...opts } = job;
    for await (const event of engine({ ...opts, abortController })) {
      io.send({ kind: "event", event });
    }
    io.send({ kind: "done" });
  } catch (e) {
    io.send({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
```

Note: the `onBrokerMessage` handler stays registered after the job resolves so a later `cancel` still reaches `abortController` — the single registration handles both.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/runner/runJob.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/runner/runJob.ts test/runner/runJob.test.ts
git commit -m "feat(runner): runJob core loop (stream events, honor cancel, report error)"
```

---

## Task 4: Runner entrypoint

**Files:**
- Create: `src/runner/main.ts`

**Interfaces:**
- Consumes: `runJob` + `RunnerIo` (Task 3); `createLineDecoder`, `encodeLine` (Task 1); `claudeAgentEngine` (`src/engine.ts`); `BrokerOut`, `RunnerOut` (Task 2).
- Produces: an executable module that wires `process.stdin` (decoded) and `process.stdout` (encoded) into `runJob(claudeAgentEngine, io)` and exits 0 on done / 1 on error.

This entrypoint is validated by Task 6's integration run (it needs the real SDK); it has no isolated unit test (the testable logic lives in `runJob`).

- [ ] **Step 1: Write the entrypoint**

```ts
// src/runner/main.ts
import { claudeAgentEngine } from "../engine.js";
import { runJob, type RunnerIo } from "./runJob.js";
import { createLineDecoder, encodeLine } from "./framing.js";
import type { BrokerOut, RunnerOut } from "./protocol.js";

const decode = createLineDecoder();
let handler: (m: BrokerOut) => void = () => {};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const msg of decode(chunk)) handler(msg as BrokerOut);
});

const io: RunnerIo = {
  onBrokerMessage: (h) => { handler = h; },
  send: (m: RunnerOut) => { process.stdout.write(encodeLine(m)); },
};

runJob(claudeAgentEngine, io)
  .then(() => process.exit(0))
  .catch((e) => { process.stderr.write(String(e instanceof Error ? e.stack : e) + "\n"); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/runner/main.ts
git commit -m "feat(runner): stdin/stdout entrypoint wiring runJob to the real engine"
```

---

## Task 5: Subprocess engine adapter

**Files:**
- Create: `src/subprocessEngine.ts`, `test/subprocessEngine.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EngineRunOptions`, `EngineEvent` (`src/engine.ts`); the protocol types; `framing`.
- Produces: `createSubprocessEngine(config: { runnerCommand: string; runnerArgs: string[]; spawnOptions?: import("node:child_process").SpawnOptions }): Engine`.
  The returned `Engine`, when called, spawns the runner, writes the `job` message, wires `opts.abortController`'s `abort` to write a `{kind:"cancel"}` message, decodes the runner's stdout into `EngineEvent`s (via an async queue), yields them, and completes when a `done` message arrives (or throws on an `error` message / non-zero exit).

The test spawns a **tiny fake runner** (a `.mjs` script echoing scripted `RunnerOut` lines) so it needs no API key — proving the marshaling, streaming, cancel-write, and error paths against a real child process.

- [ ] **Step 1: Write the failing test**

```ts
// test/subprocessEngine.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubprocessEngine } from "../src/subprocessEngine.js";

let fakeRunner: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "geode-fakerunner-"));
  fakeRunner = join(dir, "runner.mjs");
  // Reads one job line, emits two events + done. If the job's instruction is "hang",
  // it emits one event then waits, and on receiving a cancel line, exits.
  writeFileSync(fakeRunner, `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  const lines = buf.split("\\n"); buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.kind === "cancel") { process.stdout.write(JSON.stringify({kind:"event",event:{type:"text",text:"cancelled"}})+"\\n"); process.stdout.write(JSON.stringify({kind:"done"})+"\\n"); process.exit(0); }
    if (m.kind === "job") {
      process.stdout.write(JSON.stringify({kind:"event",event:{type:"text",text:m.instruction}})+"\\n");
      if (m.instruction === "hang") return;
      process.stdout.write(JSON.stringify({kind:"event",event:{type:"result",text:"final"}})+"\\n");
      process.stdout.write(JSON.stringify({kind:"done"})+"\\n");
    }
  }
});
`);
});

const runOpts = (instruction: string, abortController = new AbortController()) => ({
  instruction, cwd: "/v", systemPrompt: "", abortController,
});

describe("subprocess engine adapter", () => {
  it("marshals a job and streams events to completion", async () => {
    const engine = createSubprocessEngine({ runnerCommand: process.execPath, runnerArgs: [fakeRunner] });
    const events = [];
    for await (const ev of engine(runOpts("hello"))) events.push(ev);
    expect(events).toEqual([{ type: "text", text: "hello" }, { type: "result", text: "final" }]);
  });

  it("forwards abort as a cancel message to the runner", async () => {
    const ac = new AbortController();
    const engine = createSubprocessEngine({ runnerCommand: process.execPath, runnerArgs: [fakeRunner] });
    const events = [];
    const it = engine(runOpts("hang", ac))[Symbol.asyncIterator]();
    const first = await it.next();               // "hang" event received
    expect(first.value).toEqual({ type: "text", text: "hang" });
    ac.abort();                                   // -> writes {kind:"cancel"}
    const rest = [];
    for (let n = await it.next(); !n.done; n = await it.next()) rest.push(n.value);
    expect(rest).toContainEqual({ type: "text", text: "cancelled" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/subprocessEngine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/subprocessEngine.ts
import { spawn, type SpawnOptions } from "node:child_process";
import type { Engine, EngineEvent } from "./engine.js";
import { createLineDecoder, encodeLine } from "./runner/framing.js";
import type { JobMessage, RunnerOut } from "./runner/protocol.js";

/** Builds an Engine that runs the real engine in a spawned runner subprocess, marshaling options in and events out. */
export function createSubprocessEngine(config: { runnerCommand: string; runnerArgs: string[]; spawnOptions?: SpawnOptions }): Engine {
  return async function* (opts) {
    const child = spawn(config.runnerCommand, config.runnerArgs, { stdio: ["pipe", "pipe", "inherit"], ...config.spawnOptions });
    const { abortController, ...serializable } = opts;
    const onAbort = () => { try { child.stdin!.write(encodeLine({ kind: "cancel" })); } catch { /* child may be gone */ } };
    abortController.signal.addEventListener("abort", onAbort);

    // Async queue: stdout decoder pushes RunnerOut; the generator pulls.
    const queue: RunnerOut[] = [];
    let notify: (() => void) | null = null;
    let ended = false;
    let failure: Error | null = null;
    const wake = () => { notify?.(); notify = null; };
    const decode = createLineDecoder();
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (c: string) => { for (const m of decode(c)) queue.push(m as RunnerOut); wake(); });
    child.on("error", (e) => { failure = e; ended = true; wake(); });
    child.on("close", (code) => { if (code && code !== 0 && !failure) failure = new Error(`runner exited with code ${code}`); ended = true; wake(); });

    const jobMsg: JobMessage = { kind: "job", ...serializable };
    child.stdin!.write(encodeLine(jobMsg));

    try {
      for (;;) {
        while (queue.length) {
          const m = queue.shift()!;
          if (m.kind === "event") yield m.event as EngineEvent;
          else if (m.kind === "done") return;
          else if (m.kind === "error") throw new Error(m.message);
        }
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>((r) => { notify = r; });
      }
    } finally {
      abortController.signal.removeEventListener("abort", onAbort);
      if (!child.killed) child.kill();
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/subprocessEngine.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/subprocessEngine.ts test/subprocessEngine.test.ts
git commit -m "feat(engine): subprocess engine adapter (spawn runner, marshal events + cancel)"
```

---

## Task 6: Wire the subprocess engine into the kernel + integration-verify

**Files:**
- Modify: `src/index.ts:63` (the `engine: claudeAgentEngine` dependency)

**Interfaces:**
- Consumes: `createSubprocessEngine` (Task 5). The runner is launched with `tsx` against `src/runner/main.ts` (matching how the kernel itself runs via `tsx`).

- [ ] **Step 1: Swap the engine dependency**

In `src/index.ts`, replace `engine: claudeAgentEngine` (line 63) with a subprocess engine that runs the runner entrypoint. Resolve the runner path relative to this module and launch it the same way the kernel runs (tsx):

```ts
import { createSubprocessEngine } from "./subprocessEngine.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// ...
const runnerEntry = join(dirname(fileURLToPath(import.meta.url)), "runner", "main.ts");
// ...in the deps object, replace `engine: claudeAgentEngine` with:
engine: createSubprocessEngine({
  runnerCommand: process.execPath,
  runnerArgs: ["--import", "tsx", runnerEntry],
  spawnOptions: { env: process.env },   // 1B-1b will scrub + provision this per-runner
}),
```

(Confirm the correct tsx invocation against this repo's Node/tsx versions — if `--import tsx` is unavailable, use the same launcher the `start` script uses (`tsx <entry>`). The runner must load TypeScript exactly as the kernel does.)

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run`
Expected: green. The `query.ts` tests inject a fake `engine` directly (they never touch `claudeAgentEngine`), so they are unaffected. `engine.test.ts` tests `claudeAgentEngine`/`mapMessage` directly — also unaffected.

- [ ] **Step 3: Manual end-to-end integration check (needs a live ANTHROPIC_API_KEY)**

Start the kernel (`npx tsx --env-file=.env src/index.ts`) and, via the dashboard chat, run a simple instruction that writes a file (e.g. "create a note test.md with the text hello"). Confirm:
1. The run streams progress into the chat (events cross the pipe).
2. The file is written in the vault and committed by the broker (`git log` shows the `query run-N` commit).
3. Pressing **Stop** mid-run aborts it (cancel message reaches the runner).
4. `ps`/Activity Monitor shows a separate `tsx …/runner/main.ts` process during the run that exits after.

Record the outcome (this is the proof the subprocess architecture works with the real SDK).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(engine): run the agent in a subprocess (same-uid; process boundary established)"
```

---

## Final verification

- [ ] `npm run typecheck` — green.
- [ ] `npx vitest run` — green (framing, runJob, subprocessEngine, plus the untouched existing suites).
- [ ] `npm run lint` — green.
- [ ] Manual E2E (Task 6 Step 3) recorded: a real run streams, writes, commits, and cancels through the subprocess.
- [ ] Update `.agent/System/architecture.md` and `.agent/System/security-model.md`: the agent now executes in a spawned runner subprocess behind the `Engine` seam; the broker retains git/secrets/invoke; note this phase is same-uid (no privilege boundary yet — that is 1B-1b).

## Next phase (slice 1B-1b — NOT in this plan): the privilege drop

This plan establishes the subprocess + protocol; it does **not** add a security boundary. Slice 1B-1b turns the same-uid subprocess into a real trust boundary, per spec §6.4. It is Linux/root-dependent and partly empirical (validate on the Fly image), so it gets its own plan with a spike-first task:

1. **uid/gid drop** — the broker spawns the runner with `spawnOptions.uid`/`.gid` set to a dedicated low-privilege `geode-runner` account (requires the broker to run as root or hold `CAP_SETUID` in the container). **Graceful, loud fallback to same-uid** when setuid is unavailable (macOS dev / non-root) — consistent with the "macOS is dev-not-hardened" posture.
2. **Shared-group working tree** — the vault working tree becomes `2770` (setgid) with broker + runner in a shared group and the runner on `umask 002`, so the broker can `git add`/`reset --hard`/`clean -fd` runner-created files (§6.4). The **secrets dir stays `0700`/`0600`**, owned by the broker only — the actual Layer-1 boundary.
3. **Runner environment provisioning** — scrub the child env and forward only what the SDK needs: `ANTHROPIC_API_KEY`, a runner-owned `HOME` + `TMPDIR`, `cwd` = vault root, and the model-host egress. (Replaces the `env: process.env` passthrough this plan leaves as a placeholder.)
4. **Adversarial verification** on the Linux image — prove the runner uid cannot read the broker's secrets dir or a second vault's directory, while the broker can still commit the runner's writes. Extend `scripts/verify-sandbox.ts`.

Slice **1B-2** then adds Layer 2 (the fetch/process role split with per-role `allowedDomains` + staging) on top of this runner.

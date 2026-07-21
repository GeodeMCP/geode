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

import { expect, test } from "vitest";
import { delegate, type DelegateDeps } from "../src/delegate.js";
import { createRunManager } from "../src/runManager.js";
import type { EngineEvent } from "../src/engine.js";

function fakeWorkspace() {
  const calls: string[] = [];
  return {
    calls,
    root: "/vault",
    init: async () => {},
    isClean: async () => true,
    head: async () => "HEAD0",
    commitAll: async (m: string) => { calls.push(`commit:${m}`); return "COMMIT1"; },
    resetToHead: async () => { calls.push("reset"); },
    changedFilesSince: async (_r: string) => ["note.md"],
  };
}

function fakeEngine(events: EngineEvent[]) {
  return async function* () { for (const e of events) yield e; };
}

function fakeLog() {
  const entries: any[] = [];
  return { entries, append: async (e: any) => { entries.push(e); } };
}

function deps(over: Partial<DelegateDeps>): DelegateDeps {
  return {
    workspace: fakeWorkspace() as any,
    engine: fakeEngine([{ type: "progress", text: "p1" }, { type: "result", text: "done" }]) as any,
    runManager: createRunManager({ maxRuntimeMs: 1000, queueLimit: 4 }),
    eventLog: fakeLog() as any,
    systemPrompt: "SYS",
    ...over,
  };
}

test("on success: streams progress, commits agent changes AND the log, logs ok, returns result + files", async () => {
  const progress: string[] = [];
  const d = deps({});
  const res = await delegate(d, "do X", (m) => progress.push(m));
  expect(progress).toEqual(["p1"]);
  expect(res.text).toBe("done");
  expect(res.commit).toBe("COMMIT1");
  expect(res.filesTouched).toEqual(["note.md"]);
  expect((d.eventLog as any).entries[0]).toMatchObject({ status: "ok", commit: "COMMIT1" });
  // both the agent change and the event-log entry are committed (log must be persisted)
  expect((d.workspace as any).calls).toContain("commit:delegate run-1: do X");
  expect((d.workspace as any).calls).toContain("commit:delegate run-1: log");
});

test("on engine failure: resets, logs error, COMMITS the error entry, rethrows (no agent commit)", async () => {
  const ws = fakeWorkspace();
  const boom = async function* () { yield { type: "progress", text: "p" }; throw new Error("boom"); };
  const log = fakeLog();
  const d = deps({ workspace: ws as any, engine: boom as any, eventLog: log as any });
  await expect(delegate(d, "do Y")).rejects.toThrow("boom");
  expect(ws.calls).toContain("reset");
  expect(ws.calls).toContain("commit:delegate run-1: log (error)");
  expect(ws.calls.some((c) => c.includes("do Y"))).toBe(false); // agent change never committed
  expect(log.entries[0]).toMatchObject({ status: "error" });
});

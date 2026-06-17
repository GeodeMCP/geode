import { expect, test, vi } from "vitest";
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
    commitAll: async (_m: string) => { calls.push("commit"); return "COMMIT1"; },
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

test("on success: streams progress, commits, logs ok, returns result + files", async () => {
  const progress: string[] = [];
  const d = deps({});
  const res = await delegate(d, "do X", (m) => progress.push(m));
  expect(progress).toEqual(["p1"]);
  expect(res.text).toBe("done");
  expect(res.commit).toBe("COMMIT1");
  expect(res.filesTouched).toEqual(["note.md"]);
  expect((d.eventLog as any).entries[0]).toMatchObject({ status: "ok", commit: "COMMIT1" });
  expect((d.workspace as any).calls).toContain("commit");
});

test("on engine failure: resets workspace, logs error, rethrows", async () => {
  const ws = fakeWorkspace();
  const boom = async function* () { yield { type: "progress", text: "p" }; throw new Error("boom"); };
  const log = fakeLog();
  const d = deps({ workspace: ws as any, engine: boom as any, eventLog: log as any });
  await expect(delegate(d, "do Y")).rejects.toThrow("boom");
  expect(ws.calls).toContain("reset");
  expect(ws.calls).not.toContain("commit");
  expect(log.entries[0]).toMatchObject({ status: "error" });
});

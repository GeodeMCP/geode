import { expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type QueryDeps } from "../src/query.js";
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

function deps(over: Partial<QueryDeps>): QueryDeps {
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
  const res = await query(d, "do X", (m) => progress.push(m));
  expect(progress).toEqual(["p1"]);
  expect(res.text).toBe("done");
  expect(res.commit).toBe("COMMIT1");
  expect(res.filesTouched).toEqual(["note.md"]);
  expect((d.eventLog as any).entries[0]).toMatchObject({ status: "ok", commit: "COMMIT1" });
  // both the agent change and the event-log entry are committed (log must be persisted)
  expect((d.workspace as any).calls).toContain("commit:query run-1: do X");
  expect((d.workspace as any).calls).toContain("commit:query run-1: log");
});

test("on engine failure: resets, logs error, COMMITS the error entry, rethrows (no agent commit)", async () => {
  const ws = fakeWorkspace();
  const boom = async function* () { yield { type: "progress", text: "p" }; throw new Error("boom"); };
  const log = fakeLog();
  const d = deps({ workspace: ws as any, engine: boom as any, eventLog: log as any });
  await expect(query(d, "do Y")).rejects.toThrow("boom");
  expect(ws.calls).toContain("reset");
  expect(ws.calls).toContain("commit:query run-1: log (error)");
  expect(ws.calls.some((c) => c.includes("do Y"))).toBe(false); // agent change never committed
  expect(log.entries[0]).toMatchObject({ status: "error" });
});

test("reports only newly-created artifacts (diffs pre-existing) with bearer URLs", async () => {
  const artifactsDir = mkdtempSync(join(tmpdir(), "geode-qa-"));
  writeFileSync(join(artifactsDir, "old.md"), "old");           // pre-existing → must NOT be reported
  const writingEngine = async function* () {
    writeFileSync(join(artifactsDir, "new.md"), "new");          // created during the run → reported
    yield { type: "result", text: "done" } as any;
  };
  const d = deps({ engine: writingEngine as any, artifactsDir, baseUrl: "http://h" } as any);
  const res = await query(d, "make a report");
  expect(res.artifacts).toEqual([{ path: "new.md", url: "http://h/artifacts/new.md" }]);
  rmSync(artifactsDir, { recursive: true, force: true });
});

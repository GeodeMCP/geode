import { expect, test } from "vitest";
import { query, type QueryDeps } from "../src/query.js";
import { createRunManager } from "../src/runManager.js";
import type { EngineEvent } from "../src/engine.js";
import { resolveSandboxPolicy } from "../src/agentSandbox.js";

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
    sandboxPolicy: resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/vault"),
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

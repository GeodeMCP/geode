import { expect, test } from "vitest";
import { buildIngestInstruction, remember, type RememberArgs } from "../src/ingest.js";
import { createRunManager } from "../src/runManager.js";
import type { EngineEvent, EngineRunOptions } from "../src/engine.js";

test("buildIngestInstruction includes the framing and content; omits absent title/source", () => {
  const i = buildIngestInstruction("Client X wants net-30.");
  expect(i).toContain("Integrate the following into the vault");
  expect(i).toContain("Content:\nClient X wants net-30.");
  expect(i).not.toContain("Title hint:");
  expect(i).not.toContain("Source:");
});

test("buildIngestInstruction includes title and source when provided", () => {
  const i = buildIngestInstruction("net-30", "call 2026-06-17", "billing");
  expect(i).toContain("Title hint: billing");
  expect(i).toContain("Source: call 2026-06-17");
});

function fakeDeps(captured: { instruction?: string }) {
  return {
    workspace: {
      root: "/vault", init: async () => {}, isClean: async () => true, head: async () => "H0",
      commitAll: async () => "C1", resetToHead: async () => {}, changedFilesSince: async () => ["page.md"],
    },
    engine: async function* (opts: EngineRunOptions): AsyncIterable<EngineEvent> {
      captured.instruction = opts.instruction;
      yield { type: "result", text: "filed it" };
    },
    runManager: createRunManager({ maxRuntimeMs: 1000, queueLimit: 4 }),
    eventLog: { append: async () => {} },
    systemPrompt: "SYS",
  } as any;
}

test("remember runs query with the ingest instruction and returns the result", async () => {
  const captured: { instruction?: string } = {};
  const args: RememberArgs = { content: "Client X wants net-30.", source: "call" };
  const res = await remember(fakeDeps(captured), args);
  expect(captured.instruction).toContain("Integrate the following into the vault");
  expect(captured.instruction).toContain("Client X wants net-30.");
  expect(res.text).toBe("filed it");
});

test("remember rejects empty content", async () => {
  await expect(remember(fakeDeps({}), { content: "   " })).rejects.toThrow(/content/);
});

import { expect, test } from "vitest";
import { checkAuth, checkMcpAuth, makeQueryHandler, buildMcpServer, makeInvokeHandler } from "../src/server.js";
import { makeRememberHandler, makeListCapabilitiesHandler } from "../src/server.js";

test("checkAuth accepts the correct bearer token and rejects others", () => {
  expect(checkAuth("Bearer secret", "secret")).toBe(true);
  expect(checkAuth("Bearer wrong", "secret")).toBe(false);
  expect(checkAuth(undefined, "secret")).toBe(false);
  expect(checkAuth("secret", "secret")).toBe(false);
});

test("checkMcpAuth accepts the static bearer OR a valid OAuth token, rejects others", () => {
  const verify = (t: string) => t === "good-oauth";
  expect(checkMcpAuth("Bearer secret", "secret", verify)).toBe(true);     // static bearer
  expect(checkMcpAuth("Bearer good-oauth", "secret", verify)).toBe(true); // oauth
  expect(checkMcpAuth("Bearer nope", "secret", verify)).toBe(false);
  expect(checkMcpAuth(undefined, "secret", verify)).toBe(false);
});

test("buildMcpServer returns a fresh server instance per call (no shared transport reuse)", () => {
  const deps = { workspace: { root: "/vault" }, engine: async function* () {}, runManager: { run: async (fn: any) => fn(new AbortController(), "run-1") }, eventLog: { append: async () => {} }, systemPrompt: "SYS" } as any;
  expect(buildMcpServer(deps)).not.toBe(buildMcpServer(deps));
});

test("query handler returns a structured error result when the run throws", async () => {
  const handler = makeQueryHandler({ runQuery: async () => { throw new Error("kernel busy: run queue is full"); } } as any);
  const res = await handler({ instruction: "do X" }, {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("kernel busy");
});

test("query handler returns result text and forwards progress when a token is present", async () => {
  const sent: any[] = [];
  const handler = makeQueryHandler({
    runQuery: async (_instruction: string, onProgress?: (m: string) => void) => {
      onProgress?.("step 1");
      return { runId: "run-1", text: "done", commit: "C1", filesTouched: ["a.md"] };
    },
  } as any);
  const extra = { _meta: { progressToken: 7 }, sendNotification: async (n: any) => { sent.push(n); } };
  const res = await handler({ instruction: "do X" }, extra);
  expect(res.content[0].text).toBe("done");
  expect(sent[0].method).toBe("notifications/progress");
  expect(sent[0].params.progressToken).toBe(7);
  expect(sent[0].params.message).toBe("step 1");
});

test("remember handler returns result text + structured content and forwards progress", async () => {
  const sent: any[] = [];
  const handler = makeRememberHandler({
    runRemember: async (_args: any, onProgress?: (m: string) => void) => {
      onProgress?.("ingesting");
      return { runId: "run-1", text: "filed under brand/voice.md", commit: "C1", filesTouched: ["brand/voice.md"] };
    },
  } as any);
  const extra = { _meta: { progressToken: 3 }, sendNotification: async (n: any) => { sent.push(n); } };
  const res = await handler({ content: "x" }, extra);
  expect(res.content[0].text).toBe("filed under brand/voice.md");
  expect(res.structuredContent.filesTouched).toEqual(["brand/voice.md"]);
  expect(sent[0].params.progressToken).toBe(3);
});

test("remember handler returns a structured error when the run throws", async () => {
  const handler = makeRememberHandler({ runRemember: async () => { throw new Error("boom"); } } as any);
  const res = await handler({ content: "x" }, {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("boom");
});

test("list_capabilities handler returns the manifest text", async () => {
  const handler = makeListCapabilitiesHandler({ root: "/vault", derive: async () => ({ text: "# Capabilities\n(nothing yet)" }) });
  const res = await handler({}, {});
  expect(res.content[0].text).toContain("Capabilities");
});

test("invoke handler returns status + body", async () => {
  const handler = makeInvokeHandler({ invoke: async () => ({ status: 200, body: { ok: true } }) } as any);
  const res = await handler({ integration: "demo", action: "ping" } as any, {});
  expect(JSON.parse(res.content[0].text).status).toBe(200);
});
test("invoke handler returns a structured error when invoke throws", async () => {
  const handler = makeInvokeHandler({ invoke: async () => { throw new Error("boom"); } } as any);
  const res = await handler({ integration: "x", action: "y" } as any, {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("boom");
});

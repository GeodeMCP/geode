import { expect, test } from "vitest";
import { checkAuth, makeFindHandler, makeDelegateHandler } from "../src/server.js";

test("checkAuth accepts the correct bearer token and rejects others", () => {
  expect(checkAuth("Bearer secret", "secret")).toBe(true);
  expect(checkAuth("Bearer wrong", "secret")).toBe(false);
  expect(checkAuth(undefined, "secret")).toBe(false);
  expect(checkAuth("secret", "secret")).toBe(false);
});

test("find handler returns the result as JSON text content", async () => {
  const handler = makeFindHandler({ root: "/vault", find: async () => ({ kind: "list", entries: ["AGENTS.md"] }) } as any);
  const res = await handler({ path: "." }, {});
  const payload = JSON.parse(res.content[0].text);
  expect(payload.kind).toBe("list");
  expect(payload.entries).toEqual(["AGENTS.md"]);
});

test("delegate handler returns result text and forwards progress when a token is present", async () => {
  const sent: any[] = [];
  const handler = makeDelegateHandler({
    runDelegate: async (_instruction: string, onProgress?: (m: string) => void) => {
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

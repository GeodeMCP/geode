import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";
import { createTranscriptStore } from "../../src/transcripts.js";

let server: Server; let url: string; let root: string;
const KEY = Buffer.from("k".repeat(32));

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-api-"));
  const ws = createWorkspace(root); await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\n"); await ws.commitAll("seed");
  const app = express(); app.use(express.json());
  app.use("/api", createApiRouter({
    sessionKey: KEY, dashboardPassword: "pw", secure: false, workspace: ws,
    runQuery: async (instruction, onProgress) => {
      onProgress({ type: "tool", toolId: "t1", name: "Write", summary: "note.md", detail: "x" } as any);
      onProgress({ type: "tool_result", toolId: "t1", ok: true, output: "ok" } as any);
      writeFileSync(join(root, "note.md"), "x");
      return { runId: "run-xyz", text: "ok: " + instruction, commit: null, filesTouched: ["note.md"] };
    },
    runRemember: async (_args, onProgress) => { onProgress({ type: "text", text: "filing" }); return { runId: "r2", text: "filed", commit: null, filesTouched: [] }; },
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: createTranscriptStore(join(root, ".transcripts")),
    artifactsDir: root,
    baseUrl: "http://h",
    authToken: "test-token",
    invoke: async () => ({ status: 200, body: {} }),
  }));
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
const login = async () => {
  const res = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw" }) });
  return res.headers.get("set-cookie")!.split(";")[0];
};

beforeEach(boot);
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("guards /api/tree until logged in; login sets a cookie", async () => {
  expect((await fetch(`${url}/api/tree`)).status).toBe(401);
  expect((await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) })).status).toBe(401);
  const cookie = await login();
  const res = await fetch(`${url}/api/tree`, { headers: { cookie } });
  expect(res.status).toBe(200);
  const tree = await res.json();
  expect(tree.map((n: any) => n.name)).toContain("index.md");
});

test("POST /api/query streams SSE progress then a result event", async () => {
  const cookie = await login();
  const res = await fetch(`${url}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "do X" }) });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  expect(body).toContain("event: progress");
  expect(body).toContain("note.md");
  expect(body).toContain("event: result");
  expect(body).toContain("ok: do X");
});

test("commit then discard operate on the working tree", async () => {
  const cookie = await login();
  writeFileSync(join(root, "index.md"), "# Index\nedited\n");
  const c = await fetch(`${url}/api/commit`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ message: "m" }) });
  expect((await c.json()).commit).toBeTruthy();
  const s = await (await fetch(`${url}/api/status`, { headers: { cookie } })).json();
  expect(s.modified).toEqual([]); expect(s.created).toEqual([]);
});

test("POST /api/file writes a knowledge file (uncommitted); rejects traversal", async () => {
  const cookie = await login();
  const ok = await fetch(`${url}/api/file`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "notes/m.md", content: "# M\n" }) });
  expect((await ok.json()).ok).toBe(true);
  const f = await (await fetch(`${url}/api/file?path=notes/m.md`, { headers: { cookie } })).json();
  expect(f.content).toContain("# M");
  const bad = await fetch(`${url}/api/file`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "../evil.md", content: "x" }) });
  expect(bad.status).toBe(400);
});

test("DELETE /api/file removes a knowledge file; rejects traversal", async () => {
  const cookie = await login();
  await fetch(`${url}/api/file`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "notes/del.md", content: "bye" }) });
  const del = await fetch(`${url}/api/file?path=notes/del.md`, { method: "DELETE", headers: { cookie } });
  expect((await del.json()).ok).toBe(true);
  expect((await fetch(`${url}/api/file?path=notes/del.md`, { headers: { cookie } })).status).toBe(400); // gone → read fails
  const bad = await fetch(`${url}/api/file?path=../evil`, { method: "DELETE", headers: { cookie } });
  expect(bad.status).toBe(400);
});

test("records each query run and serves it via GET /api/history; DELETE clears it", async () => {
  const cookie = await login();
  await fetch(`${url}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "do X" }) }).then((r) => r.text());
  const hist = await (await fetch(`${url}/api/history`, { headers: { cookie } })).json();
  expect(hist).toHaveLength(1);
  expect(hist[0]).toMatchObject({ runId: "run-xyz", instruction: "do X", result: { text: "ok: do X" } });
  expect(hist[0].events.map((e: any) => e.type)).toEqual(["tool", "tool_result"]);
  const del = await fetch(`${url}/api/history`, { method: "DELETE", headers: { cookie } });
  expect((await del.json()).ok).toBe(true);
  expect(await (await fetch(`${url}/api/history`, { headers: { cookie } })).json()).toEqual([]);
});

test("GET /api/history requires a session", async () => {
  expect((await fetch(`${url}/api/history`)).status).toBe(401);
});

test("GET /api/connect requires a session and returns mcpUrl, token, and the tool catalog", async () => {
  expect((await fetch(`${url}/api/connect`)).status).toBe(401);
  const cookie = await login();
  const body = await (await fetch(`${url}/api/connect`, { headers: { cookie } })).json();
  expect(body.mcpUrl).toMatch(/\/mcp$/);
  expect(body.authToken).toBe("test-token");
  expect(body.tools.map((t: any) => t.name)).toEqual(["query", "remember", "list_capabilities", "invoke"]);
});

test("an errored query run is still recorded with error + a generated runId", async () => {
  // Self-contained app whose runQuery throws — the shared boot()'s runQuery always succeeds.
  const root2 = mkdtempSync(join(tmpdir(), "geode-api-err-"));
  const ws2 = createWorkspace(root2); await ws2.init();
  const app2 = express(); app2.use(express.json());
  app2.use("/api", createApiRouter({
    sessionKey: KEY, dashboardPassword: "pw", secure: false, workspace: ws2,
    runQuery: async () => { throw new Error("engine boom"); },
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: createTranscriptStore(join(root2, ".transcripts")),
    artifactsDir: root2, baseUrl: "http://h", invoke: async () => ({ status: 200, body: {} }),
  }));
  const srv2 = await new Promise<Server>((r) => { const s = app2.listen(0, () => r(s)); });
  try {
    const u2 = `http://localhost:${(srv2.address() as any).port}`;
    const cookie = (await fetch(`${u2}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw" }) })).headers.get("set-cookie")!.split(";")[0];
    await fetch(`${u2}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "do X" }) }).then((r) => r.text());
    const hist = await (await fetch(`${u2}/api/history`, { headers: { cookie } })).json();
    expect(hist).toHaveLength(1);
    expect(hist[0].error).toBe("engine boom");
    expect(typeof hist[0].runId).toBe("string");
    expect(hist[0].runId.length).toBeGreaterThan(0);
    expect(hist[0].result).toBeUndefined();
  } finally {
    srv2.close(); rmSync(root2, { recursive: true, force: true });
  }
});

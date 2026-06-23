import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";

let server: Server; let url: string; let root: string;
const KEY = Buffer.from("k".repeat(32));

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-api-"));
  const ws = createWorkspace(root); await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\n"); await ws.commitAll("seed");
  const app = express(); app.use(express.json());
  app.use("/api", createApiRouter({
    sessionKey: KEY, dashboardPassword: "pw", secure: false, workspace: ws,
    runQuery: async (instruction, onProgress) => { onProgress("thinking"); writeFileSync(join(root, "note.md"), "x"); return { runId: "r1", text: "ok: " + instruction, commit: null, filesTouched: ["note.md"] }; },
    runRemember: async (_args, onProgress) => { onProgress("filing"); return { runId: "r2", text: "filed", commit: null, filesTouched: [] }; },
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    artifactsDir: root,
    baseUrl: "http://h",
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
  expect(body).toContain("thinking");
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

import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";
import { createTranscriptStore } from "../../src/transcripts.js";
import { createAccountStore } from "../../src/account.js";
import type { Docker } from "../../src/docker.js";

const stubDocker: Docker = {
  available: async () => false,
  imageExists: async () => false,
  build: async () => {},
  run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  removeImage: async () => {},
};
const stubAttachments = { dir: "/att", add: async () => [], list: async () => [], clear: async () => {} };

let server: Server; let url: string; let root: string;
const KEY = Buffer.from("k".repeat(32));

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-api-"));
  const ws = createWorkspace(root); await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\n"); await ws.commitAll("seed");
  const app = express(); app.use(express.json());
  const accounts = createAccountStore(join(root, ".accounts"));
  accounts.createOwner({ email: "owner@test.dev", password: "owner-password-1" });
  app.use("/api", createApiRouter({
    sessionKey: KEY, secure: false, workspace: ws,
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
    accounts,
    invoke: async () => ({ status: 200, body: {} }),
    docker: stubDocker,
    cancelQuery: () => {},
    toolsDir: root,
    attachments: stubAttachments,
  }));
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
const login = async () => {
  const res = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "owner-password-1" }) });
  return res.headers.get("set-cookie")!.split(";")[0];
};

beforeEach(boot);
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("guards /api/tree until logged in; login sets a cookie", async () => {
  expect((await fetch(`${url}/api/tree`)).status).toBe(401);
  expect((await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "wrong" }) })).status).toBe(401);
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

test("POST /api/query passes the attachment folder to runQuery when it is non-empty", async () => {
  // Self-contained app: a runQuery that captures opts and an attachment store reporting one staged file.
  const calls: any[] = [];
  const root4 = mkdtempSync(join(tmpdir(), "geode-api-att-"));
  const ws4 = createWorkspace(root4); await ws4.init();
  const app4 = express(); app4.use(express.json());
  const accounts4 = createAccountStore(join(root4, ".accounts"));
  accounts4.createOwner({ email: "owner@test.dev", password: "owner-password-1" });
  app4.use("/api", createApiRouter({
    sessionKey: KEY, secure: false, workspace: ws4,
    runQuery: async (instruction, _onProgress, opts) => { calls.push({ instruction, opts }); return { runId: "run-1", text: "ok", commit: null, filesTouched: [] }; },
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: createTranscriptStore(join(root4, ".transcripts")),
    artifactsDir: root4, baseUrl: "http://h", accounts: accounts4, invoke: async () => ({ status: 200, body: {} }),
    docker: stubDocker,
    cancelQuery: () => {},
    toolsDir: root4,
    attachments: { dir: "/att", add: async () => [], list: async () => ["administratie/x.md"], clear: async () => {} },
  }));
  const srv4 = await new Promise<Server>((r) => { const s = app4.listen(0, () => r(s)); });
  try {
    const u4 = `http://localhost:${(srv4.address() as any).port}`;
    const cookie = (await fetch(`${u4}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "owner-password-1" }) })).headers.get("set-cookie")!.split(";")[0];
    await fetch(`${u4}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "process these" }) }).then((r) => r.text());
    expect(calls[0].opts.attachmentDirs).toEqual(["/att"]);
  } finally {
    srv4.close(); rmSync(root4, { recursive: true, force: true });
  }
});

test("POST /api/query passes recent history to runQuery so follow-ups have context", async () => {
  // Self-contained app: needs a fake transcripts store with a prior turn and a runQuery that captures opts.
  const calls: any[] = [];
  const root5 = mkdtempSync(join(tmpdir(), "geode-api-history-"));
  const ws5 = createWorkspace(root5); await ws5.init();
  const app5 = express(); app5.use(express.json());
  const accounts5 = createAccountStore(join(root5, ".accounts"));
  accounts5.createOwner({ email: "owner@test.dev", password: "owner-password-1" });
  app5.use("/api", createApiRouter({
    sessionKey: KEY, secure: false, workspace: ws5,
    runQuery: async (instruction, _onProgress, opts) => { calls.push({ instruction, opts }); return { runId: "run-2", text: "ok", commit: null, filesTouched: [] }; },
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: { list: async () => [{ runId: "r", ts: 0, instruction: "boek q1", events: [], result: { text: "done 3 rows" } }], append: async () => {}, clear: async () => {} },
    artifactsDir: root5, baseUrl: "http://h", accounts: accounts5, invoke: async () => ({ status: 200, body: {} }),
    docker: stubDocker,
    cancelQuery: () => {},
    toolsDir: root5,
    attachments: stubAttachments,
  }));
  const srv5 = await new Promise<Server>((r) => { const s = app5.listen(0, () => r(s)); });
  try {
    const u5 = `http://localhost:${(srv5.address() as any).port}`;
    const cookie = (await fetch(`${u5}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "owner-password-1" }) })).headers.get("set-cookie")!.split(";")[0];
    await fetch(`${u5}/api/query`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ instruction: "go 1,3" }) }).then((r) => r.text());
    expect(calls[0].opts.history).toContain("boek q1");
  } finally {
    srv5.close(); rmSync(root5, { recursive: true, force: true });
  }
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
  expect(body.publicBaseUrl).toBe("http://h");
  expect(body.tools.map((t: any) => t.name)).toEqual(["query", "remember", "list_capabilities", "invoke"]);
});

test("an errored query run is still recorded with error + a generated runId", async () => {
  // Self-contained app whose runQuery throws — the shared boot()'s runQuery always succeeds.
  const root2 = mkdtempSync(join(tmpdir(), "geode-api-err-"));
  const ws2 = createWorkspace(root2); await ws2.init();
  const app2 = express(); app2.use(express.json());
  const accounts2 = createAccountStore(join(root2, ".accounts"));
  accounts2.createOwner({ email: "owner@test.dev", password: "owner-password-1" });
  app2.use("/api", createApiRouter({
    sessionKey: KEY, secure: false, workspace: ws2,
    runQuery: async () => { throw new Error("engine boom"); },
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: createTranscriptStore(join(root2, ".transcripts")),
    artifactsDir: root2, baseUrl: "http://h", accounts: accounts2, invoke: async () => ({ status: 200, body: {} }),
    docker: stubDocker,
    cancelQuery: () => {},
    toolsDir: root2,
    attachments: stubAttachments,
  }));
  const srv2 = await new Promise<Server>((r) => { const s = app2.listen(0, () => r(s)); });
  try {
    const u2 = `http://localhost:${(srv2.address() as any).port}`;
    const cookie = (await fetch(`${u2}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "owner-password-1" }) })).headers.get("set-cookie")!.split(";")[0];
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

test("auth-info reports login mode (owner exists) and reflects the session", async () => {
  const info = await (await fetch(`${url}/api/auth-info`)).json();
  expect(info).toMatchObject({ mode: "login", authed: false });
  const cookie = await login();
  const authed = await (await fetch(`${url}/api/auth-info`, { headers: { cookie } })).json();
  expect(authed).toMatchObject({ mode: "login", authed: true });
});

test("setup is forbidden once an owner exists (409)", async () => {
  const res = await fetch(`${url}/api/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "correct-horse" }) });
  expect(res.status).toBe(409);
});

test("no-owner kernel: setup needs no cookie, then login switches to the account", async () => {
  // Self-contained app with an empty accounts store — the first-run flow.
  const root3 = mkdtempSync(join(tmpdir(), "geode-api-setup-"));
  const ws3 = createWorkspace(root3); await ws3.init();
  const app3 = express(); app3.use(express.json());
  app3.use("/api", createApiRouter({
    sessionKey: KEY, secure: false, workspace: ws3,
    runQuery: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    linkKey: KEY,
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: createTranscriptStore(join(root3, ".transcripts")),
    artifactsDir: root3, baseUrl: "http://h", accounts: createAccountStore(join(root3, ".accounts")), invoke: async () => ({ status: 200, body: {} }),
    docker: stubDocker,
    cancelQuery: () => {},
    toolsDir: root3,
    attachments: stubAttachments,
  }));
  const srv3 = await new Promise<Server>((r) => { const s = app3.listen(0, () => r(s)); });
  try {
    const u3 = `http://localhost:${(srv3.address() as any).port}`;
    expect(await (await fetch(`${u3}/api/auth-info`)).json()).toMatchObject({ mode: "setup" });
    // No owner yet → setup is allowed without a session.
    const ok = await fetch(`${u3}/api/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "me@example.com", password: "correct-horse" }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
    expect(await (await fetch(`${u3}/api/auth-info`)).json()).toMatchObject({ mode: "login" });
  } finally {
    srv3.close(); rmSync(root3, { recursive: true, force: true });
  }
});

test("login is rate-limited after repeated failures", async () => {
  let last = 200;
  for (let i = 0; i < 12; i++) {
    last = (await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "wrong" }) })).status;
  }
  expect(last).toBe(429);
});

import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";
import { createAccountStore } from "../../src/account.js";

let server: Server; let url: string; let root: string; let artDir: string;
const KEY = Buffer.from("k".repeat(32));
const secretRefs: string[] = [];

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-apiops-"));
  artDir = mkdtempSync(join(tmpdir(), "geode-apiops-art-"));
  writeFileSync(join(artDir, "report.md"), "hello");
  const ws = createWorkspace(root); await ws.init();
  mkdirSync(join(root, "integrations", "demo"), { recursive: true });
  writeFileSync(join(root, "integrations", "demo", "manifest.json"), JSON.stringify({
    name: "demo", type: "connection", description: "d", requires: ["DEMO_KEY"], actions: { ping: { method: "GET", url: "https://h/p" } },
  }));
  mkdirSync(join(root, "tools", "demo"), { recursive: true });
  writeFileSync(join(root, "tools", "demo", "TOOL.md"), "---\nid: demo\nname: demo\ntype: http\ndescription: d\nrequires: [DEMO_KEY]\nconnections: [{label: default}]\nactions:\n  ping:\n    http: {method: GET, url: \"https://h/p\"}\n---\n");
  const app = express(); app.use(express.json());
  const accounts = createAccountStore(join(root, ".accounts"));
  accounts.createOwner({ email: "owner@test.dev", password: "owner-password-1" });
  app.use("/api", createApiRouter({
    sessionKey: KEY, secure: false, workspace: ws, linkKey: KEY,
    runQuery: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    secrets: { list: async () => secretRefs, get: async () => null, set: async () => {}, delete: async (r: string) => { const i = secretRefs.indexOf(r); if (i >= 0) secretRefs.splice(i, 1); } } as any,
    artifacts: { mintPublicUrl: (p: string) => `http://h/artifacts/${p}?sig=x&exp=1`, resolve: (p: string) => join(artDir, p) } as any,
    artifactsDir: artDir, baseUrl: "http://h", authToken: "test-token",
    accounts,
    invoke: async (a: any) => ({ status: 200, body: { echoed: a.action } }),
  }));
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
const login = async () => (await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "owner-password-1" }) })).headers.get("set-cookie")!.split(";")[0];

beforeEach(async () => { secretRefs.length = 0; await boot(); });
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); rmSync(artDir, { recursive: true, force: true }); });

test("integrations list/detail compose credential status; test calls invoke", async () => {
  const cookie = await login();
  const list = await (await fetch(`${url}/api/integrations`, { headers: { cookie } })).json();
  expect(list[0]).toMatchObject({ name: "demo", type: "connection" });
  expect(list[0].requiredSecrets).toEqual([{ ref: "DEMO_KEY", set: false }]);
  const test = await (await fetch(`${url}/api/integrations/demo/test`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "ping" }) })).json();
  expect(test).toEqual({ status: 200, body: { echoed: "ping" } });
});

test("secrets: mint link, list requiredBy, delete", async () => {
  const cookie = await login();
  secretRefs.push("DEMO_KEY");
  const sec = await (await fetch(`${url}/api/secrets`, { headers: { cookie } })).json();
  expect(sec).toEqual([{ ref: "DEMO_KEY", requiredBy: ["demo"] }]);
  const link = await (await fetch(`${url}/api/secrets/NEW_KEY/link`, { method: "POST", headers: { cookie } })).json();
  expect(link.url).toContain("/auth/s/");
  const del = await fetch(`${url}/api/secrets/DEMO_KEY`, { method: "DELETE", headers: { cookie } });
  expect((await del.json()).ok).toBe(true);
  expect(secretRefs).toEqual([]);
});

test("artifacts list + download + public-link", async () => {
  const cookie = await login();
  const arts = await (await fetch(`${url}/api/artifacts`, { headers: { cookie } })).json();
  expect(arts).toEqual([{ path: "report.md" }]);
  const dl = await fetch(`${url}/api/artifacts/download?path=report.md`, { headers: { cookie } });
  expect(await dl.text()).toBe("hello");
  const pub = await (await fetch(`${url}/api/artifacts/public-link`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "report.md" }) })).json();
  expect(pub.url).toContain("sig=");
});

test("capabilities renders the derived menu", async () => {
  const cookie = await login();
  const cap = await (await fetch(`${url}/api/capabilities`, { headers: { cookie } })).json();
  expect(cap.tools.map((t: any) => t.id)).toContain("demo");
});

test("path-traversal route params are rejected", async () => {
  const cookie = await login();
  expect((await fetch(`${url}/api/integrations/..%2f..%2fetc`, { headers: { cookie } })).status).toBe(404);
  expect((await fetch(`${url}/api/secrets/..%2f..%2fX`, { method: "DELETE", headers: { cookie } })).status).toBe(400);
  expect((await fetch(`${url}/api/secrets/..%2fX/link`, { method: "POST", headers: { cookie } })).status).toBe(400);
});

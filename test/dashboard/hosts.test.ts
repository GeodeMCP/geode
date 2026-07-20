import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiRouter } from "../../src/dashboard/api.js";
import { createWorkspace } from "../../src/workspace.js";
import { createAccountStore } from "../../src/account.js";
import type { Docker } from "../../src/docker.js";

const stubDocker: Docker = {
  available: async () => false,
  imageExists: async () => false,
  build: async () => {},
  run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  removeImage: async () => {},
};

let server: Server; let url: string; let root: string; let artDir: string;
const KEY = Buffer.from("k".repeat(32));
const secretRefs: string[] = [];

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-apiops-"));
  artDir = mkdtempSync(join(tmpdir(), "geode-apiops-art-"));
  writeFileSync(join(artDir, "report.md"), "hello");
  const ws = createWorkspace(root); await ws.init();
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
    docker: stubDocker,
    toolsDir: root,
  }));
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
const login = async () => (await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.dev", password: "owner-password-1" }) })).headers.get("set-cookie")!.split(";")[0];

beforeEach(async () => { secretRefs.length = 0; await boot(); });
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); rmSync(artDir, { recursive: true, force: true }); });

test("GET /hosts reports the declared host as pending, approve moves it, revoke removes it", async () => {
  const cookie = await login();
  // the seeded demo tool's action url is https://h/p → declared host "h"
  let r = await fetch(`${url}/api/tools/demo/hosts`, { headers: { cookie } });
  expect(await r.json()).toEqual({ approved: [], pending: ["h"] });

  r = await fetch(`${url}/api/tools/demo/hosts/approve`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ host: "h" }) });
  expect(await r.json()).toEqual({ approved: ["h"], pending: [] });

  r = await fetch(`${url}/api/hosts/pending`, { headers: { cookie } });
  expect(await r.json()).toEqual([]); // nothing pending once approved

  r = await fetch(`${url}/api/tools/demo/hosts/h`, { method: "DELETE", headers: { cookie } });
  expect(await r.json()).toEqual({ approved: [], pending: ["h"] });
});

test("approve on an unknown tool id 404s and writes no hosts.json", async () => {
  const cookie = await login();
  const r = await fetch(`${url}/api/tools/nope/hosts/approve`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ host: "h" }) });
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "unknown tool" });
  expect(existsSync(join(root, "nope", "hosts.json"))).toBe(false);
});

test("revoke on an unknown tool id 404s and writes no hosts.json", async () => {
  const cookie = await login();
  const r = await fetch(`${url}/api/tools/nope/hosts/h`, { method: "DELETE", headers: { cookie } });
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: "unknown tool" });
  expect(existsSync(join(root, "nope", "hosts.json"))).toBe(false);
});

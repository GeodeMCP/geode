import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountDashboard } from "../../src/dashboard/index.js";
import { createWorkspace } from "../../src/workspace.js";
import { createTranscriptStore } from "../../src/transcripts.js";
import { createAccountStore } from "../../src/account.js";
import type { Docker } from "../../src/docker.js";

const stubDocker: Docker = {
  available: async () => false, imageExists: async () => false, build: async () => {},
  run: async () => ({ exitCode: 0, stdout: "", stderr: "" }), removeImage: async () => {},
};
const KEY = Buffer.from("k".repeat(32));
let server: Server; let url: string; let root: string; let webDir: string;

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-spa-"));
  webDir = mkdtempSync(join(tmpdir(), "geode-web-"));
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Geode</title>");
  mkdirSync(join(webDir, "assets"));
  writeFileSync(join(webDir, "assets", "index-abc123.js"), "console.log(1)");
  const ws = createWorkspace(root); await ws.init();
  const accounts = createAccountStore(join(root, ".accounts"));
  const app = express(); app.use(express.json());
  mountDashboard(app, {
    sessionKey: KEY, workspace: ws, webDir,
    runQuery: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    secrets: { list: async () => [], delete: async () => {}, set: async () => {} } as any,
    artifacts: {} as any,
    transcripts: createTranscriptStore(join(root, ".transcripts")),
    artifactsDir: root, baseUrl: "http://h", authToken: "t", accounts, linkKey: KEY,
    invoke: async () => ({ status: 200, body: {} }), docker: stubDocker, toolsDir: root,
  });
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}

beforeEach(boot);
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); rmSync(webDir, { recursive: true, force: true }); });

test("index.html at / is served with no-cache so a rebuilt bundle is picked up", async () => {
  const res = await fetch(`${url}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("no-cache");
});

test("a client route (SPA fallback) also returns no-cache index.html", async () => {
  const res = await fetch(`${url}/some/vault/route`);
  expect(res.status).toBe(200);
  expect((await res.text())).toContain("Geode");
  expect(res.headers.get("cache-control")).toContain("no-cache");
});

test("content-hashed assets are cached immutably", async () => {
  const res = await fetch(`${url}/assets/index-abc123.js`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("immutable");
});

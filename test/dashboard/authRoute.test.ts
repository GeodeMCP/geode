import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountDashboard } from "../../src/dashboard/index.js";
import { createWorkspace } from "../../src/workspace.js";
import { mintSecretLink } from "../../src/dashboard/secretLinks.js";

let server: Server; let url: string; let root: string;
const KEY = Buffer.from("k".repeat(32));
const stored: Record<string, string> = {};

async function boot() {
  root = mkdtempSync(join(tmpdir(), "geode-authrt-"));
  const ws = createWorkspace(root); await ws.init();
  const app = express(); app.use(express.json());
  mountDashboard(app, {
    sessionKey: KEY, dashboardPassword: "pw", workspace: ws, webDir: "/nonexistent", linkKey: KEY,
    runQuery: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    runRemember: async () => ({ runId: "r", text: "", commit: null, filesTouched: [] }),
    secrets: { list: async () => Object.keys(stored), get: async () => null, set: async (r: string, v: string) => { stored[r] = v; }, delete: async () => {} } as any,
    artifacts: {} as any, artifactsDir: root, baseUrl: "http://h",
    invoke: async () => ({ status: 200, body: {} }),
  });
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}`; r(); }); });
}
beforeEach(async () => { for (const k of Object.keys(stored)) delete stored[k]; await boot(); });
afterEach(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("GET renders the auth screen; POST stores the secret; the link is single-use", async () => {
  const token = mintSecretLink(KEY, "NOTION_TOKEN", 600_000);
  const page = await fetch(`${url}/auth/s/${token}`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("NOTION_TOKEN");
  const post = await fetch(`${url}/auth/s/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=secret-xyz" });
  expect(post.status).toBe(200);
  expect(stored.NOTION_TOKEN).toBe("secret-xyz");
  // single-use: a second POST is refused (410)
  const again = await fetch(`${url}/auth/s/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "value=second" });
  expect(again.status).toBe(410);
});

test("an invalid/expired token yields 410", async () => {
  expect((await fetch(`${url}/auth/s/garbage`)).status).toBe(410);
});

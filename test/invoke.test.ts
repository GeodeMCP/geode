import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { invoke } from "../src/invoke.js";

function vaultWith(id: string, md: string): string {
  const root = mkdtempSync(join(tmpdir(), "geode-inv-"));
  mkdirSync(join(root, "tools", id), { recursive: true });
  writeFileSync(join(root, "tools", id, "TOOL.md"), md);
  return root;
}
const fakeSecrets = (m: Record<string, string>) => ({ get: async (r: string) => m[r] ?? null });

const HTTP = `---
id: demo
name: Demo
type: http
description: d
requires: [API_KEY]
connections: [{ label: default }]
actions:
  ping:
    http: { method: GET, url: "https://example.test/p", headers: { X-Key: "\${conn.API_KEY}" } }
---
`;
const CLI = `---
id: cli1
name: Cli
type: cli
description: d
connections: [{ label: default }]
actions: { run: { command: "go" } }
---
`;

test("http invoke resolves conn + params and returns status/body", async () => {
  const root = vaultWith("demo", HTTP);
  let seenHeader = "";
  const fetchFn = (async (_url: string, init: any) => { seenHeader = init.headers["X-Key"]; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  const r = await invoke({ root, secrets: fakeSecrets({ "demo__default__API_KEY": "sek" }), fetchFn }, { tool: "demo", action: "ping" });
  expect(seenHeader).toBe("sek");
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ ok: true });
});

test("invalid connection + needs-setup errors", async () => {
  const root = vaultWith("demo", HTTP);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "demo", action: "ping", connection: "nope" })).rejects.toThrow(/not a connection/);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "demo", action: "ping" })).rejects.toThrow(/needs setup/);
});

test("cli/mcp executors are inert in 2a", async () => {
  const root = vaultWith("cli1", CLI);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "cli1", action: "run" })).rejects.toThrow(/executor 'cli' not available yet/);
});

test("unknown tool + action errors", async () => {
  const root = vaultWith("demo", HTTP);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "ghost", action: "x" })).rejects.toThrow(/unknown tool/);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "demo", action: "nope" })).rejects.toThrow(/unknown action/);
});

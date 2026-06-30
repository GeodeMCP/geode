import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTool } from "../src/sandboxRun.js";
import { installTool } from "../src/installer.js";
import type { Docker } from "../src/docker.js";

const MD = `---
id: cb
name: CB
type: cli
description: d
image: { base: b }
requires: [TOKEN]
connections: [{ label: default }]
permissions: { network: none }
bin: "./cb"
actions: { fetch: { command: "fetch --url \${params.url}" } }
---`;
function vault() { const root = mkdtempSync(join(tmpdir(), "ge-")); mkdirSync(join(root, "tools", "cb"), { recursive: true }); writeFileSync(join(root, "tools", "cb", "TOOL.md"), MD); return root; }
const docker = (over: Partial<Docker> = {}): Docker => ({ available: async () => true, imageExists: async () => true, build: async () => {}, run: async () => ({ exitCode: 0, stdout: '{"ok":true}', stderr: "" }), removeImage: async () => {}, ...over });
const secrets = (m: Record<string,string>) => ({ get: async (r: string) => m[r] ?? null });

test("runCliTool runs the action's command in a fresh container and returns stdout+exit", async () => {
  const root = vault(); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await installTool({ root, toolsDir, docker: docker() }, "cb", { network: "none" });
  let ranArgs: string[] = [];
  const d = docker({ run: async (args) => { ranArgs = args; return { exitCode: 0, stdout: '{"ok":true}', stderr: "" }; } });
  const r = await runCliTool({ root, toolsDir, docker: d, secrets: secrets({ "cb__default__TOKEN": "sek" }) }, "cb", "fetch", { url: "https://x" }, "default");
  expect(r).toEqual({ status: 0, body: { ok: true } });
  expect(ranArgs).toContain("--network"); expect(ranArgs).toContain("none");
  // command resolved
  expect(ranArgs.join(" ")).toContain("fetch --url https://x");
});

test("runCliTool errors when the tool is not installed", async () => {
  const root = vault(); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await expect(runCliTool({ root, toolsDir, docker: docker(), secrets: secrets({}) }, "cb", "fetch", {}, "default")).rejects.toThrow(/must install/);
});

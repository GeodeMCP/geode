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
actions: { fetch: { command: ["fetch", "--url", "\${params.url}"] } }
---`;
function vault() { const root = mkdtempSync(join(tmpdir(), "ge-")); mkdirSync(join(root, "tools", "cb"), { recursive: true }); writeFileSync(join(root, "tools", "cb", "TOOL.md"), MD); return root; }
const docker = (over: Partial<Docker> = {}): Docker => ({ available: async () => true, imageExists: async () => true, build: async () => {}, run: async () => ({ exitCode: 0, stdout: '{"ok":true}', stderr: "" }), removeImage: async () => {}, ...over });
const secrets = (m: Record<string,string>) => ({ get: async (r: string) => m[r] ?? null });

// Builds an installed vault from the given manifest, runs `action`, and returns the captured
// container argv = the portion of `docker.run`'s args after the image tag.
async function runCapturingArgs(md: string, id: string, action: string, params: Record<string, unknown>): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "ge-")); mkdirSync(join(root, "tools", id), { recursive: true });
  writeFileSync(join(root, "tools", id, "TOOL.md"), md);
  const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await installTool({ root, toolsDir, docker: docker() }, id, { network: "none" });
  const tag = `geode-tool/${id}:latest`;
  let ranArgs: string[] = [];
  const d = docker({ run: async (args) => { ranArgs = args; return { exitCode: 0, stdout: '{"ok":true}', stderr: "" }; } });
  await runCliTool({ root, toolsDir, docker: d, secrets: secrets({ [`${id}__default__TOKEN`]: "sek" }) }, id, action, params, "default");
  return ranArgs.slice(ranArgs.indexOf(tag) + 1);
}

test("runCliTool runs the action's command in a fresh container and returns stdout+exit", async () => {
  const root = vault(); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await installTool({ root, toolsDir, docker: docker() }, "cb", { network: "none" });
  let ranArgs: string[] = [];
  const d = docker({ run: async (args) => { ranArgs = args; return { exitCode: 0, stdout: '{"ok":true}', stderr: "" }; } });
  const r = await runCliTool({ root, toolsDir, docker: d, secrets: secrets({ "cb__default__TOKEN": "sek" }) }, "cb", "fetch", { url: "https://x" }, "default");
  expect(r).toEqual({ status: 0, body: { ok: true } });
  expect(ranArgs).toContain("--network"); expect(ranArgs).toContain("none");
  expect(ranArgs).toContain("--name");
  // command resolved
  expect(ranArgs.join(" ")).toContain("fetch --url https://x");
});

test("runCliTool errors when the tool is not installed", async () => {
  const root = vault(); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await expect(runCliTool({ root, toolsDir, docker: docker(), secrets: secrets({}) }, "cb", "fetch", {}, "default")).rejects.toThrow(/must install/);
});

test("keeps a spaced/quoted param value as a single argv element (no breakout)", async () => {
  const captured = await runCapturingArgs(MD, "cb", "fetch", { url: "http://x/ a' b" });
  expect(captured).toContain("http://x/ a' b"); // exactly one element, unsplit
  expect(captured.filter((t) => t.includes("a'"))).toHaveLength(1);
});

const PY = `---
id: py
name: Py
type: cli
description: d
image: { base: b }
requires: [TOKEN]
connections: [{ label: default }]
permissions: { network: none }
bin: "python"
actions: { script: { command: ["-c", "print('\${params.x}')"] } }
---`;

test("builds a multiline -c script as one argv element", async () => {
  const captured = await runCapturingArgs(PY, "py", "script", { x: "hi" });
  expect(captured).toEqual(["python", "-c", "print('hi')"]);
});

const NODE = `---
id: nd
name: Nd
type: cli
description: d
image: { base: b }
requires: [TOKEN]
connections: [{ label: default }]
permissions: { network: none }
bin: "node dist/cli.js"
actions: { fetch: { command: ["fetch"] } }
---`;

test("splits a multi-token bin into separate argv tokens", async () => {
  const captured = await runCapturingArgs(NODE, "nd", "fetch", {});
  expect(captured.slice(0, 3)).toEqual(["node", "dist/cli.js", "fetch"]);
});

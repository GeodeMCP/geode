import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTool, readInstallState, uninstallTool } from "../src/installer.js";
import type { Docker } from "../src/docker.js";

function vault(id: string, md: string) { const root = mkdtempSync(join(tmpdir(), "ge-")); mkdirSync(join(root, "tools", id), { recursive: true }); writeFileSync(join(root, "tools", id, "TOOL.md"), md); return root; }
const MD = `---
id: cb
name: CB
type: cli
description: d
image: { base: "node:20-slim" }
source: { repo: "https://github.com/x/cb", ref: "v1" }
bin: "./cb"
actions: { fetch: { command: "fetch" } }
---`;
function fakeDocker(over: Partial<Docker> = {}): Docker {
  return { available: async () => true, imageExists: async () => false, build: async () => {}, run: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }), removeImage: async () => {}, ...over };
}

test("installTool builds, smoke-runs, and records state", async () => {
  const root = vault("cb", MD);
  const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  let built = "";
  const docker = fakeDocker({ build: async (tag) => { built = tag; } });
  const state = await installTool({ root, toolsDir, docker }, "cb", { network: "none" });
  expect(built).toBe("geode-tool/cb:v1");
  expect(state.image).toBe("geode-tool/cb:v1");
  expect((await readInstallState(toolsDir, "cb"))?.image).toBe("geode-tool/cb:v1");
});

test("installTool fails (and records nothing) when smoke run exits non-zero", async () => {
  const root = vault("cb", MD);
  const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  const docker = fakeDocker({ run: async () => ({ exitCode: 1, stdout: "", stderr: "boom" }) });
  await expect(installTool({ root, toolsDir, docker }, "cb", { network: "none" })).rejects.toThrow(/smoke/);
  expect(await readInstallState(toolsDir, "cb")).toBeNull();
});

test("installTool refuses when Docker is unavailable", async () => {
  const root = vault("cb", MD); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await expect(installTool({ root, toolsDir, docker: fakeDocker({ available: async () => false }) }, "cb", { network: "none" })).rejects.toThrow(/Docker/);
});

test("uninstallTool removes the image + state", async () => {
  const root = vault("cb", MD); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await installTool({ root, toolsDir, docker: fakeDocker() }, "cb", { network: "none" });
  await uninstallTool({ toolsDir, docker: fakeDocker() }, "cb");
  expect(await readInstallState(toolsDir, "cb")).toBeNull();
});

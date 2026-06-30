import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadTool } from "./tools.js";
import { imageTag, buildDockerfile, runArgs, type Docker } from "./docker.js";

/** Persisted record that a tool is installed. */
export interface InstallState { id: string; image: string; ref?: string; permissions: { network?: unknown }; approvedAt: string }

const statePath = (toolsDir: string, id: string) => join(toolsDir, id, "installed.json");

/** Reads a tool's install state, or null if not installed. */
export async function readInstallState(toolsDir: string, id: string): Promise<InstallState | null> {
  try { return JSON.parse(await readFile(statePath(toolsDir, id), "utf8")) as InstallState; } catch { return null; }
}

/** Builds the tool's image, smoke-runs it, and records install state. `approvedPermissions` = the owner-approved perms. */
export async function installTool(deps: { root: string; toolsDir: string; docker: Docker }, id: string, approvedPermissions: { network?: unknown }): Promise<InstallState> {
  if (!(await deps.docker.available())) throw new Error("Docker is required to install a cli/repo tool, and it is not available. Install + start Docker, then retry.");
  const m = await loadTool(deps.root, id);
  if (m.type !== "cli") throw new Error(`tool ${id} is not a cli tool`);
  const tag = imageTag(m);
  await deps.docker.build(tag, buildDockerfile(m));
  // smoke: run the bin with no args (must exit 0). `--network none`, no creds.
  const smoke = await deps.docker.run(runArgs({ tag, command: m.bin ? [m.bin] : [], envFile: "/dev/null", network: "none", timeoutMs: 30000 }), 30000);
  if (smoke.exitCode !== 0) throw new Error(`smoke run failed for ${id} (exit ${smoke.exitCode}): ${smoke.stderr.slice(-400)}`);
  const state: InstallState = { id, image: tag, ref: m.source?.ref, permissions: approvedPermissions, approvedAt: new Date().toISOString() };
  await mkdir(join(deps.toolsDir, id), { recursive: true });
  await writeFile(statePath(deps.toolsDir, id), JSON.stringify(state, null, 2));
  return state;
}

/** Removes a tool's image + install state. */
export async function uninstallTool(deps: { toolsDir: string; docker: Docker }, id: string): Promise<void> {
  const st = await readInstallState(deps.toolsDir, id);
  if (st) await deps.docker.removeImage(st.image);
  if (existsSync(statePath(deps.toolsDir, id))) await rm(statePath(deps.toolsDir, id));
}

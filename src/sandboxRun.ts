import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretStore } from "./secrets.js";
import type { Docker } from "./docker.js";
import { loadTool, resolveTemplate, resolveConnection, loadConnBundle } from "./tools.js";
import { imageTag, runArgs } from "./docker.js";
import { readInstallState } from "./installer.js";
import type { InvokeResult } from "./invoke.js";

/** Runs one action of an installed cli tool in a fresh sandboxed container; returns exit-code + parsed stdout. */
export async function runCliTool(
  deps: { root: string; toolsDir: string; docker: Docker; secrets: Pick<SecretStore, "get"> },
  toolId: string, actionName: string, params: Record<string, unknown>, connection?: string,
): Promise<InvokeResult> {
  const m = await loadTool(deps.root, toolId);
  if (!(await readInstallState(deps.toolsDir, toolId))) throw new Error(`tool "${toolId}" is not installed — the owner must install it first`);
  if (m.materialize && m.materialize.inject === "profile") throw new Error(`profile-dir credentials are not supported yet (#4)`);
  const action = m.actions[actionName];
  if (!action?.command) throw new Error(`unknown cli action "${actionName}" on "${toolId}"`);
  const label = resolveConnection(m.connections ?? [], connection);
  const conn = await loadConnBundle(deps.secrets, toolId, label, m.requires ?? []);
  const command = resolveTemplate(`${m.bin ? m.bin + " " : ""}${action.command}`, { params, conn });
  const env = m.materialize?.env ? Object.fromEntries(Object.entries(m.materialize.env).map(([k, v]) => [k, resolveTemplate(v, { params, conn })])) : conn;
  const network = m.permissions?.network && m.permissions.network !== "none" ? "bridge" : "none";
  const dir = await mkdtemp(join(tmpdir(), "geode-env-"));
  const envFile = join(dir, "env");
  await writeFile(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"), { mode: 0o600 });
  try {
    const r = await deps.docker.run(runArgs({ tag: imageTag(m), command: command.split(/\s+/), envFile, network, memoryMb: m.limits?.memoryMb ?? 512, cpus: m.limits?.cpus ?? 1, timeoutMs: m.limits?.timeoutMs ?? 60000 }), m.limits?.timeoutMs ?? 60000);
    let body: unknown = r.stdout; try { body = JSON.parse(r.stdout); } catch { /* keep text */ }
    return { status: r.exitCode, body };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

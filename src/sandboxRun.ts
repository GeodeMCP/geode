import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SecretStore } from "./secrets.js";
import type { Docker } from "./docker.js";
import { loadTool, resolveTemplate, resolveConnection, loadConnBundle, binTokens } from "./tools.js";
import { imageTag, runArgs } from "./docker.js";
import { readInstallState } from "./installer.js";
import type { InvokeResult } from "./invoke.js";
import { startEgressProxy } from "./egressProxy.js";
import { readApproval } from "./approvals.js";

/** Decides the container network mode + egress allowlist from a tool's declared hosts and its approved set: only approved hosts may be reached; none approved → no network. */
export function computeCliNetwork(declaredNetwork: string[] | undefined, approved: string[]): { network: "none" | "bridge"; allow: string[] } {
  const declared = Array.isArray(declaredNetwork) ? declaredNetwork : [];
  const allow = declared.filter((h) => approved.includes(h.toLowerCase()));
  return allow.length ? { network: "bridge", allow } : { network: "none", allow: [] };
}

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
  const ctx = { params, conn };
  const argv = [...binTokens(m.bin), ...action.command.map((t) => resolveTemplate(t, ctx))];
  const env = m.materialize?.env ? Object.fromEntries(Object.entries(m.materialize.env).map(([k, v]) => [k, resolveTemplate(v, ctx)])) : conn;
  const approved = (await readApproval(deps.toolsDir, toolId)).approvedHosts;
  const { network, allow } = computeCliNetwork(Array.isArray(m.permissions?.network) ? m.permissions.network as string[] : undefined, approved);
  const dir = await mkdtemp(join(tmpdir(), "geode-env-"));
  const envFile = join(dir, "env");
  const proxy = allow.length ? await startEgressProxy(allow) : null;
  try {
    const proxyEnv = proxy ? { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url } : {};
    const envEntries = { ...env, ...proxyEnv };
    for (const [k, v] of Object.entries(envEntries)) {
      if (/[\r\n]/.test(v)) throw new Error(`refusing to run: env value for ${k} contains a newline`);
    }
    await writeFile(envFile, Object.entries(envEntries).map(([k, v]) => `${k}=${v}`).join("\n"), { mode: 0o600 });
    const name = `geode-${toolId}-${randomUUID().slice(0, 8)}`;
    const timeoutMs = m.limits?.timeoutMs ?? 60000;
    const r = await deps.docker.run(runArgs({ name, tag: imageTag(m), command: argv, envFile, network, memoryMb: m.limits?.memoryMb ?? 512, cpus: m.limits?.cpus ?? 1, timeoutMs }), { timeoutMs, killName: name });
    if (r.timedOut) return { status: 124, body: "timed out" };
    let body: unknown = r.stdout; try { body = JSON.parse(r.stdout); } catch { /* keep text */ }
    return { status: r.exitCode, body };
  } finally {
    await proxy?.close();
    await rm(dir, { recursive: true, force: true });
  }
}

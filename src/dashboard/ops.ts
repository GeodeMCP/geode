import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type SecretStore } from "../secrets.js";
import { listToolIds, loadTool, connectionConfigured, type ToolManifest } from "../tools.js";
import { readInstallState } from "../installer.js";

/** Flattened dashboard view of a tool with per-connection configured status. */
export interface ToolView {
  id: string; name: string; type: string; description: string;
  actions: { name: string; description?: string }[];
  connections: { label: string; description?: string; configured: boolean }[];
  requires: string[];
  /** Whether this cli tool has been installed (image built + state recorded). Always false for non-cli tools. */
  installed: boolean;
  /** The permissions declared in the manifest (cli tools only). */
  permissions: { network?: unknown; filesystem?: string[] } | undefined;
}

/** Maps a tool manifest to a ToolView, resolving per-connection configured status from the secret store. */
async function toView(m: ToolManifest, toolsDir: string, secrets: Pick<SecretStore, "get">): Promise<ToolView> {
  const connections = [];
  for (const c of m.connections ?? []) connections.push({ label: c.label, description: c.description, configured: await connectionConfigured(secrets, m.id, c.label, m.requires ?? []) });
  const installState = m.type === "cli" ? await readInstallState(toolsDir, m.id) : null;
  return { id: m.id, name: m.name, type: m.type, description: m.description, actions: Object.entries(m.actions).map(([name, a]) => ({ name, description: a.description })), connections, requires: m.requires ?? [], installed: installState !== null, permissions: m.permissions };
}

/** Reads all tools under <root>/tools and returns their views with connection status. */
export async function listTools(root: string, toolsDir: string, secrets: Pick<SecretStore, "get">): Promise<ToolView[]> {
  const out: ToolView[] = [];
  for (const id of (await listToolIds(root)).sort()) { try { out.push(await toView(await loadTool(root, id), toolsDir, secrets)); } catch { /* skip malformed */ } }
  return out;
}

/** Loads a single tool by id and returns its view. */
export async function getTool(root: string, toolsDir: string, id: string, secrets: Pick<SecretStore, "get">): Promise<ToolView> {
  return toView(await loadTool(root, id), toolsDir, secrets);
}

/** Lists stored secret refs, annotating each with the tool id it belongs to (the part before the first `__`). */
export async function listSecrets(_root: string, secrets: Pick<SecretStore, "list">): Promise<{ ref: string; requiredBy: string[] }[]> {
  return (await secrets.list()).map((ref) => ({ ref, requiredBy: ref.includes("__") ? [ref.split("__")[0]] : [] }));
}

/** Recursively enumerates all files under the artifacts directory, returning their workspace-relative POSIX paths. */
export function listArtifacts(dir: string): { path: string }[] {
  if (!existsSync(dir)) return [];
  const out: { path: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).split(sep).join("/") });
    }
  };
  walk(dir);
  return out;
}

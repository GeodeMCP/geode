import { readdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SecretStore } from "../secrets.js";
import { loadIntegration, type IntegrationManifest } from "../integrations.js";

export interface IntegrationView {
  name: string; type: string; description: string;
  actions: { name: string; method: string; url: string; description?: string }[];
  requiredSecrets: { ref: string; set: boolean }[];
}

function toView(m: IntegrationManifest, setRefs: Set<string>): IntegrationView {
  return {
    name: m.name, type: m.type ?? "connection", description: m.description ?? "",
    actions: Object.entries(m.actions ?? {}).map(([name, a]) => ({ name, method: a.method, url: a.url, description: a.description })),
    requiredSecrets: (m.requires ?? []).map((ref) => ({ ref, set: setRefs.has(ref) })),
  };
}

export async function listIntegrations(root: string, secrets: Pick<SecretStore, "list">): Promise<IntegrationView[]> {
  let dirs: string[] = [];
  try { dirs = (await readdir(join(root, "integrations"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
  const setRefs = new Set(await secrets.list());
  const out: IntegrationView[] = [];
  for (const name of dirs) {
    try { out.push(toView(await loadIntegration(root, name), setRefs)); } catch { /* skip malformed */ }
  }
  return out;
}

export async function getIntegration(root: string, name: string, secrets: Pick<SecretStore, "list">): Promise<IntegrationView> {
  return toView(await loadIntegration(root, name), new Set(await secrets.list()));
}

export async function listSecrets(root: string, secrets: Pick<SecretStore, "list">): Promise<{ ref: string; requiredBy: string[] }[]> {
  const refs = await secrets.list();
  const ints = await listIntegrations(root, secrets);
  return refs.map((ref) => ({ ref, requiredBy: ints.filter((i) => i.requiredSecrets.some((s) => s.ref === ref)).map((i) => i.name) }));
}

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

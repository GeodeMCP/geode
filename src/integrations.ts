import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface IntegrationAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown; description?: string }
export interface IntegrationManifest { name: string; type: "connection"; description: string; requires: string[]; actions: Record<string, IntegrationAction> }

export async function loadIntegration(root: string, name: string): Promise<IntegrationManifest> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`invalid integration name: ${name}`);
  const raw = await readFile(join(root, "integrations", name, "manifest.json"), "utf8");
  return JSON.parse(raw) as IntegrationManifest;
}

export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; secrets: Record<string, string> }): string {
  return input.replace(/\$\{(params|secrets)\.([\w-]+)\}/g, (_m, ns: string, k: string) => {
    const v = ns === "params" ? ctx.params[k] : ctx.secrets[k];
    // Fail loudly rather than silently substituting "" — an unresolved ref would
    // otherwise fire a malformed request at a real external API.
    if (v === undefined || v === null) throw new Error(`unresolved template reference: \${${ns}.${k}} — provide it in the invoke ${ns}`);
    return String(v);
  });
}

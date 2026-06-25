import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Describes a single HTTP action defined in an integration manifest. */
export interface IntegrationAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown; description?: string }
/** The full parsed content of an integration's manifest.json file. */
export interface IntegrationManifest { name: string; type: "connection"; description: string; requires: string[]; actions: Record<string, IntegrationAction> }

/** Reads and parses the manifest.json for a named integration under the vault root, rejecting unsafe names. */
export async function loadIntegration(root: string, name: string): Promise<IntegrationManifest> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`invalid integration name: ${name}`);
  const raw = await readFile(join(root, "integrations", name, "manifest.json"), "utf8");
  return JSON.parse(raw) as IntegrationManifest;
}

/** Replaces `${params.key}` and `${secrets.key}` placeholders in a string, throwing if any reference is unresolved. */
export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; secrets: Record<string, string> }): string {
  return input.replace(/\$\{(params|secrets)\.([\w-]+)\}/g, (_m, ns: string, k: string) => {
    const v = ns === "params" ? ctx.params[k] : ctx.secrets[k];
    // Fail loudly rather than silently substituting "" — an unresolved ref would
    // otherwise fire a malformed request at a real external API.
    if (v === undefined || v === null) throw new Error(`unresolved template reference: \${${ns}.${k}} — provide it in the invoke ${ns}`);
    return String(v);
  });
}

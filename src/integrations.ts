import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface IntegrationAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown; description?: string }
export interface IntegrationManifest { name: string; type: "connection"; description: string; requires: string[]; actions: Record<string, IntegrationAction> }

export async function loadIntegration(root: string, name: string): Promise<IntegrationManifest> {
  const raw = await readFile(join(root, "integrations", name, "manifest.json"), "utf8");
  return JSON.parse(raw) as IntegrationManifest;
}

export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; secrets: Record<string, string> }): string {
  return input.replace(/\$\{(params|secrets)\.([\w-]+)\}/g, (_m, ns: string, k: string) => {
    const v = ns === "params" ? ctx.params[k] : ctx.secrets[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

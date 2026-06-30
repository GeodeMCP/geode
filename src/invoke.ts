import type { SecretStore } from "./secrets.js";
import { loadTool, resolveTemplate, resolveConnection, loadConnBundle } from "./tools.js";

/** Arguments to call a single tool action by name, optionally selecting a connection. */
export interface InvokeArgs { tool: string; action: string; params?: Record<string, unknown>; connection?: string; workspace?: string }
/** HTTP status code and parsed (or raw text) response body returned from a tool action call. */
export interface InvokeResult { status: number; body: unknown }

/** Loads the tool manifest, resolves the connection bundle, and dispatches the action by executor type. */
export async function invoke(
  deps: { root: string; secrets: Pick<SecretStore, "get">; fetchFn?: typeof fetch },
  args: InvokeArgs,
): Promise<InvokeResult> {
  const manifest = await loadTool(deps.root, args.tool).catch(() => { throw new Error(`unknown tool: ${args.tool}`); });
  const action = manifest.actions[args.action];
  if (!action) throw new Error(`unknown action "${args.action}" on tool "${args.tool}"`);
  const label = resolveConnection(manifest.connections ?? [], args.connection);
  const conn = await loadConnBundle(deps.secrets, args.tool, label, manifest.requires ?? []);
  const params = args.params ?? {};
  if (manifest.type === "cli" || manifest.type === "mcp") throw new Error(`executor '${manifest.type}' not available yet (slice #3)`);
  const http = action.http;
  if (!http) throw new Error(`action "${args.action}" has no http definition`);
  const ctx = { params, conn };
  const url = resolveTemplate(http.url, ctx);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(http.headers ?? {})) headers[k] = resolveTemplate(v, ctx);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(http.query ?? {})) q.set(k, resolveTemplate(v, ctx));
  const qs = q.toString();
  const body = http.body === undefined ? undefined : typeof http.body === "string" ? resolveTemplate(http.body, ctx) : JSON.stringify(http.body);
  const resp = await (deps.fetchFn ?? fetch)(qs ? `${url}?${qs}` : url, { method: http.method, headers, body });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: resp.status, body: parsed };
}

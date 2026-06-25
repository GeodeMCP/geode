import type { SecretStore } from "./secrets.js";
import { loadIntegration, resolveTemplate } from "./integrations.js";

/** Arguments required to call a single integration action by name. */
export interface InvokeArgs { integration: string; action: string; params?: Record<string, unknown>; workspace?: string }
/** HTTP status code and parsed (or raw text) response body returned from an integration action call. */
export interface InvokeResult { status: number; body: unknown }

/** Loads the named integration manifest, resolves secrets and template variables, and executes the HTTP action, returning its status and body. */
export async function invoke(
  deps: { root: string; secrets: Pick<SecretStore, "get">; fetchFn?: typeof fetch },
  args: InvokeArgs,
): Promise<InvokeResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const manifest = await loadIntegration(deps.root, args.integration).catch(() => { throw new Error(`unknown integration: ${args.integration}`); });
  const action = manifest.actions[args.action];
  if (!action) throw new Error(`unknown action "${args.action}" on integration "${args.integration}"`);
  const secrets: Record<string, string> = {};
  for (const ref of manifest.requires ?? []) {
    const v = await deps.secrets.get(ref);
    if (v === null) throw new Error(`secret "${ref}" is not set — add it with: npm run secret -- set ${ref}`);
    secrets[ref] = v;
  }
  const params = args.params ?? {};
  const ctx = { params, secrets };
  const url = resolveTemplate(action.url, ctx);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(action.headers ?? {})) headers[k] = resolveTemplate(v, ctx);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(action.query ?? {})) q.set(k, resolveTemplate(v, ctx));
  const qs = q.toString();
  const body = action.body === undefined ? undefined : typeof action.body === "string" ? resolveTemplate(action.body, ctx) : JSON.stringify(action.body);
  const resp = await fetchFn(qs ? `${url}?${qs}` : url, { method: action.method, headers, body });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: resp.status, body: parsed };
}

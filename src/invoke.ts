import type { SecretStore } from "./secrets.js";
import { loadTool, resolveTemplate, resolveTemplateOptional, resolveConnection, loadConnBundle } from "./tools.js";
import { targetHost } from "./hostPolicy.js";
import { readApproval } from "./approvals.js";

/** Arguments to call a single tool action by name, optionally selecting a connection. */
export interface InvokeArgs { tool: string; action: string; params?: Record<string, unknown>; connection?: string; workspace?: string }
/** HTTP status code and parsed (or raw text) response body returned from a tool action call. */
export interface InvokeResult { status: number; body: unknown }

const MAX_REDIRECTS = 5;

/** Builds the standard "not approved" error for a tool/host pair, matching the pre-flight check's wording. */
function hostNotApprovedError(toolId: string, host: string | null, fallback: string): Error {
  return new Error(`host not approved for tool "${toolId}": ${host ?? fallback} — approve it in the dashboard before this action can run`);
}

/**
 * Issues the request with manual redirect handling: each 3xx hop's destination host is re-validated
 * against the tool's approvals before it is followed, so credentials can never be re-sent to a host
 * that was never approved. Follows at most `MAX_REDIRECTS` hops.
 */
async function fetchWithApprovedRedirects(
  fetchImpl: typeof fetch,
  initialUrl: string,
  init: { method: string; headers: Record<string, string>; body: string | undefined },
  toolsDir: string,
  toolId: string,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirects = 0; ; redirects++) {
    const resp = await fetchImpl(currentUrl, { ...init, redirect: "manual" } as RequestInit);
    const location = resp.status >= 300 && resp.status < 400 ? resp.headers.get("location") : null;
    if (!location) return resp;
    if (redirects >= MAX_REDIRECTS) throw new Error(`too many redirects for tool "${toolId}": ${initialUrl}`);
    const nextUrl = new URL(location, currentUrl).toString();
    const host = targetHost(nextUrl);
    const { approvedHosts } = await readApproval(toolsDir, toolId);
    if (!host || !approvedHosts.includes(host)) throw hostNotApprovedError(toolId, host, nextUrl);
    currentUrl = nextUrl;
  }
}

/** Loads the tool manifest, resolves the connection bundle, and dispatches the action by executor type. */
export async function invoke(
  deps: { root: string; secrets: Pick<SecretStore, "get">; fetchFn?: typeof fetch; toolsDir?: string; docker?: import("./docker.js").Docker; connector?: import("./mcpProxy.js").McpConnector },
  args: InvokeArgs,
): Promise<InvokeResult> {
  const manifest = await loadTool(deps.root, args.tool).catch((e: unknown) => {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") throw new Error(`unknown tool: ${args.tool}`);
    throw e; // surface invalid-id / invalid-YAML / missing-fields instead of a misleading "unknown tool"
  });
  const action = manifest.actions[args.action];
  if (!action) throw new Error(`unknown action "${args.action}" on tool "${args.tool}"`);
  const label = resolveConnection(manifest.connections ?? [], args.connection);
  const conn = await loadConnBundle(deps.secrets, args.tool, label, manifest.requires ?? []);
  const params = args.params ?? {};
  if (manifest.type === "mcp") {
    if (!deps.connector) throw new Error("mcp executor not configured");
    if (deps.toolsDir) {
      const transportUrl = manifest.transport?.url;
      const host = transportUrl ? targetHost(transportUrl) : null;
      const { approvedHosts } = await readApproval(deps.toolsDir, args.tool);
      if (!host || !approvedHosts.includes(host)) throw hostNotApprovedError(args.tool, host, transportUrl ?? "(no transport url)");
    }
    const { runMcpTool } = await import("./mcpProxy.js");
    return runMcpTool({ root: deps.root, connector: deps.connector, secrets: deps.secrets }, args.tool, args.action, params, args.connection);
  }
  if (manifest.type === "cli") {
    if (!deps.toolsDir || !deps.docker) throw new Error("cli executor not configured");
    const { runCliTool } = await import("./sandboxRun.js");
    return runCliTool({ root: deps.root, toolsDir: deps.toolsDir, docker: deps.docker, secrets: deps.secrets }, args.tool, args.action, params, args.connection);
  }
  const http = action.http;
  if (!http) throw new Error(`action "${args.action}" has no http definition`);
  const ctx = { params, conn };
  const url = resolveTemplate(http.url, ctx);
  if (deps.toolsDir) {
    const host = targetHost(url);
    const { approvedHosts } = await readApproval(deps.toolsDir, args.tool);
    if (!host || !approvedHosts.includes(host)) throw hostNotApprovedError(args.tool, host, url);
  }
  // Query params and non-auth headers are optional-friendly: if a value references a param the caller
  // omitted, drop that entry instead of throwing (url and body stay strict — they must resolve).
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(http.headers ?? {})) {
    const resolved = resolveTemplateOptional(v, ctx);
    if (resolved !== null) headers[k] = resolved;
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(http.query ?? {})) {
    const resolved = resolveTemplateOptional(v, ctx);
    if (resolved !== null) q.set(k, resolved);
  }
  const qs = q.toString();
  const body = http.body === undefined ? undefined : typeof http.body === "string" ? resolveTemplate(http.body, ctx) : JSON.stringify(http.body);
  const fetchImpl = deps.fetchFn ?? fetch;
  const requestUrl = qs ? `${url}?${qs}` : url;
  const resp = deps.toolsDir
    ? await fetchWithApprovedRedirects(fetchImpl, requestUrl, { method: http.method, headers, body }, deps.toolsDir, args.tool)
    : await fetchImpl(requestUrl, { method: http.method, headers, body });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: resp.status, body: parsed };
}

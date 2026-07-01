import type { SecretStore } from "./secrets.js";
import { loadTool, resolveTemplate, resolveConnection, loadConnBundle } from "./tools.js";
import type { InvokeResult } from "./invoke.js";

/** A live MCP client session to one external server. */
export interface McpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError: boolean }>;
  close(): Promise<void>;
}
/** Opens MCP client sessions to external servers (real = SDK-backed; stubbed in tests). */
export interface McpConnector {
  connectHttp(opts: { url: string; headers: Record<string, string>; timeoutMs: number }): Promise<McpClient>;
}

/** The real StreamableHTTP MCP client connector, backed by @modelcontextprotocol/sdk. */
export function realMcpConnector(): McpConnector {
  return {
    async connectHttp({ url, headers, timeoutMs }) {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
      const client = new Client({ name: "geode-proxy", version: "0.1.0" });
      await client.connect(transport);
      return {
        async callTool(name, args) {
          const r = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
          return { content: (r as { structuredContent?: unknown }).structuredContent ?? r.content, isError: !!r.isError };
        },
        async close() { await client.close(); },
      };
    },
  };
}

/** Runs one action of an `mcp` tool by proxying it to the external server via the injected connector. */
export async function runMcpTool(
  deps: { root: string; connector: McpConnector; secrets: Pick<SecretStore, "get"> },
  toolId: string, actionName: string, params: Record<string, unknown>, connection?: string,
): Promise<InvokeResult> {
  const m = await loadTool(deps.root, toolId);
  if (m.transport?.kind === "stdio") throw new Error(`stdio mcp transport not available yet — needs the sandbox (#3b-2)`);
  if (m.transport?.kind !== "http" || !m.transport.url) throw new Error(`mcp tool "${toolId}" has no http transport url`);
  const action = m.actions[actionName];
  if (!action?.remote_tool) throw new Error(`mcp action "${actionName}" on "${toolId}" has no remote_tool`);
  const label = resolveConnection(m.connections ?? [], connection);
  const conn = await loadConnBundle(deps.secrets, toolId, label, m.requires ?? []);
  const headers = Object.fromEntries(
    Object.entries(m.transport.headers ?? {}).map(([k, v]) => [k, resolveTemplate(v, { params: {}, conn })]),
  );
  const client = await deps.connector.connectHttp({ url: m.transport.url, headers, timeoutMs: m.limits?.timeoutMs ?? 60000 });
  try {
    const r = await client.callTool(action.remote_tool, params);
    return { status: r.isError ? 502 : 200, body: r.content };
  } finally {
    await client.close();
  }
}

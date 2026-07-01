# #3b — mcp-proxy executor (http transport)

**Slice:** #3b, the third executor. Completes the unified tool model: `http` ✓ · `cli` ✓ · `mcp` (this). The caller uses the same `invoke` door for all three.

**Goal:** `invoke` on an `mcp`-type tool makes the kernel act as an **MCP client**: connect to an external MCP server over StreamableHTTP, call the remote tool named `action.remote_tool` with the params, return the result. v1 supports the **`http`** transport only; **`stdio`** (arbitrary local code) is deferred to #3b-2 where it gets the Docker sandbox.

## Scope
- **In:** `transport.kind === "http"` — connect to a remote MCP server URL, optional header auth from a connection secret, proxy one `callTool`.
- **Out (deferred #3b-2):** `stdio` transport (spawns a local MCP server → must run sandboxed via `docker run -i <built-image>`). v1 returns a clear error for it. Also out: OAuth-authed MCP servers (that's #4 outbound-OAuth); multi-tool aggregation as first-class hub-tools (v1 is proxy-through-`invoke`, per the settled design).

## Schema — `src/tools.ts`

The manifest already has `transport?: { kind: "stdio"|"http"; command?: string; url?: string; ref?: string }` and `ToolAction.remote_tool?`. Add optional header auth:

```ts
transport?: { kind: "stdio" | "http"; command?: string; url?: string; ref?: string; headers?: Record<string, string> };
```

`headers` values are templated with `${conn.*}` (a connection secret), mirroring the `http` executor's header templating — this covers bearer/custom-header auth. No new required fields; existing manifests are unaffected.

Example `mcp` manifest:
```yaml
id: acme-mcp
type: mcp
transport:
  kind: http
  url: "https://mcp.acme.com/mcp"
  headers: { Authorization: "Bearer ${conn.TOKEN}" }
requires: [TOKEN]
connections: [{ label: default }]
actions:
  search:
    remote_tool: "acme_search"
    params: [{ name: query, required: true }]
```

## Components

### `src/mcpProxy.ts` (new)

An injectable connector (mirrors the `Docker` interface, so `invoke` stays unit-testable):

```ts
/** A live MCP client session to one external server. */
export interface McpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown; isError: boolean }>;
  close(): Promise<void>;
}
/** Opens MCP client sessions (real = SDK-backed; stubbed in tests). */
export interface McpConnector {
  connectHttp(opts: { url: string; headers: Record<string, string>; timeoutMs: number }): Promise<McpClient>;
}
```

`realMcpConnector()` uses the SDK: `new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })` + `new Client({ name: "geode-proxy", version: "0.1.0" })`, `await client.connect(transport)`. `callTool` → `client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs })`, returning `{ content: result.structuredContent ?? result.content, isError: !!result.isError }`. `close` → `client.close()`.

`runMcpTool(deps, toolId, actionName, params, connection)` → `InvokeResult`:
1. `loadTool`; if `transport.kind === "stdio"` throw `"stdio mcp transport not available yet — needs the sandbox (#3b-2)"`; if not `http` or no `url`, throw a clear config error.
2. `action = m.actions[actionName]`; if no `action.remote_tool` throw `unknown/for non-mcp action`.
3. `resolveConnection` + `loadConnBundle` (secrets) — same as http/cli.
4. Resolve `transport.headers` values via `resolveTemplate(v, { params: {}, conn })` (conn refs only).
5. `client = await deps.connector.connectHttp({ url, headers, timeoutMs: m.limits?.timeoutMs ?? 60000 })`.
6. `try { const r = await client.callTool(action.remote_tool, params); return { status: r.isError ? 502 : 200, body: r.content }; } finally { await client.close(); }`.

### `src/invoke.ts`

Replace the `mcp` throw with a dispatch (parallel to the `cli` branch):
```ts
if (manifest.type === "mcp") {
  if (!deps.connector) throw new Error("mcp executor not configured");
  const { runMcpTool } = await import("./mcpProxy.js");
  return runMcpTool({ root: deps.root, connector: deps.connector, secrets: deps.secrets }, args.tool, args.action, params, args.connection);
}
```
`invoke` deps gains `connector?: McpConnector`.

### Wiring — `src/server.ts` + `src/index.ts`

`buildMcpServer` opts and the dashboard `invoke` closure gain `connector` (default `realMcpConnector()`), passed into `invoke`, exactly like `docker` is wired today (`server.ts` opts + `index.ts` two call sites).

## Error handling
- No local process, no sandbox (http transport runs no local code — consistent with `http` tools).
- Connect/call failures and the SDK timeout surface as thrown errors → the `invoke` MCP-tool handler already maps thrown errors to an error response; `runMcpTool` closes the client in `finally`.
- A remote tool returning `isError` → `{ status: 502, body: content }` (the caller sees the remote error content, actionable).
- Missing connection secret → the existing `loadConnBundle` "needs setup" error.

## Testing

### Unit — `test/mcpProxy.test.ts` (stub `McpConnector`)
- **Happy path:** a manifest with `transport.http` + `headers: { Authorization: "Bearer ${conn.TOKEN}" }` + `requires: [TOKEN]`, secret set → `runMcpTool` calls `connectHttp` with the resolved URL and `Authorization: "Bearer <token>"`, calls `callTool("acme_search", { query })`, returns `{ status: 200, body }`. Assert the stub captured the url/headers/tool-name/args.
- **isError:** stub `callTool` returns `{ isError: true, content }` → `{ status: 502, body: content }`.
- **stdio deferred:** a `transport.kind: "stdio"` manifest → throws `/needs the sandbox/`.
- **config errors:** action without `remote_tool` throws; missing connection secret throws the "needs setup" error; `close()` is called even when `callTool` throws.

### Integration — `test/integration/mcpProxy.integration.test.ts`
Stand up a real in-process MCP server (`McpServer` with one echo tool) over `StreamableHTTPServerTransport` on `express` at a random port, then use **`realMcpConnector()`** to proxy a `callTool` and assert the echoed result. This exercises the real SDK client↔server path over HTTP (no network, no mocks). Gate/skip consistently with the other integration tests if the suite separates them; otherwise keep it in the default run (it's in-process and fast).

## Out of scope (follow-ups)
- **#3b-2:** `stdio` MCP transport, sandboxed via `docker run -i <built-image>` (reuses #3's image build + hardening + an interactive run variant + session container lifecycle).
- **#4:** OAuth-authed MCP servers (token acquisition/refresh); v1 only injects a static header from a connection secret.
- First-class hub-tool aggregation (exposing a remote server's whole tool list) — v1 is one-action-per-`remote_tool` proxy.

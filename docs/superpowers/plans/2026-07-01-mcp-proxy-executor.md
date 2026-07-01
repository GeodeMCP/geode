# #3b — mcp-proxy executor (http) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `invoke` on an `mcp` tool proxies to an external MCP server over StreamableHTTP (http transport). stdio deferred to #3b-2.

**Architecture:** New `src/mcpProxy.ts` with an injectable `McpConnector` (mirrors the `Docker` injection) so `runMcpTool` is unit-testable with a stub and integration-tested against a real in-process server. `invoke` dispatches `mcp` → `runMcpTool`, with the connector wired through `server.ts`/`index.ts` like `docker`.

**Tech Stack:** TypeScript ESM, vitest, `@modelcontextprotocol/sdk` ^1.29.0 (client: `client/index.js` `Client`, `client/streamableHttp.js` `StreamableHTTPClientTransport`).

**Spec:** `docs/superpowers/specs/2026-07-01-mcp-proxy-executor-design.md`

**Conventions:** terse style; husky gate = eslint + JSDoc-on-exports + `tsc`. Every export needs a `/** … */`. Server tests from repo root: `npx vitest run`.

---

### Task 1: `mcpProxy.ts` module + schema + unit tests

**Files:** Create `src/mcpProxy.ts`, `test/mcpProxy.test.ts`; Modify `src/tools.ts` (add `transport.headers`).

- [ ] **Step 1: Add `transport.headers` to `src/tools.ts`**
Change the `transport` field on `ToolManifest`:
```ts
transport?: { kind: "stdio" | "http"; command?: string; url?: string; ref?: string; headers?: Record<string, string> };
```

- [ ] **Step 2: Write `test/mcpProxy.test.ts` (TDD, stub connector)**
```ts
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMcpTool, type McpConnector } from "../src/mcpProxy.js";

function vaultWith(id: string, manifest: string): string {
  const root = mkdtempSync(join(tmpdir(), "geode-mcp-"));
  mkdirSync(join(root, "tools", id), { recursive: true });
  writeFileSync(join(root, "tools", id, "TOOL.md"), manifest);
  return root;
}
const fakeSecrets = (m: Record<string, string>) => ({ get: async (k: string) => m[k] ?? null });

const HTTP_MCP = `---
id: acme
name: Acme
type: mcp
transport: { kind: http, url: "https://mcp.acme.com/mcp", headers: { Authorization: "Bearer \${conn.TOKEN}" } }
requires: [TOKEN]
connections: [{ label: default }]
actions:
  search: { remote_tool: "acme_search", params: [{ name: query, required: true }] }
---`;

const STDIO_MCP = `---
id: acme
name: Acme
type: mcp
transport: { kind: stdio, command: "acme-mcp" }
actions:
  search: { remote_tool: "acme_search" }
---`;

test("proxies to the remote tool with the resolved auth header, returns 200, closes", async () => {
  const calls: any = {};
  const connector: McpConnector = {
    connectHttp: async (opts) => { calls.opts = opts; return {
      callTool: async (name, args) => { calls.tool = name; calls.args = args; return { content: { hits: 1 }, isError: false }; },
      close: async () => { calls.closed = true; },
    }; },
  };
  const root = vaultWith("acme", HTTP_MCP);
  const r = await runMcpTool({ root, connector, secrets: fakeSecrets({ "acme__default__TOKEN": "sekret" }) }, "acme", "search", { query: "x" }, "default");
  expect(r).toEqual({ status: 200, body: { hits: 1 } });
  expect(calls.opts.url).toBe("https://mcp.acme.com/mcp");
  expect(calls.opts.headers.Authorization).toBe("Bearer sekret");
  expect(calls.tool).toBe("acme_search");
  expect(calls.args).toEqual({ query: "x" });
  expect(calls.closed).toBe(true);
});

test("maps a remote isError to 502 and still closes the client", async () => {
  let closed = false;
  const connector: McpConnector = { connectHttp: async () => ({
    callTool: async () => ({ content: "boom", isError: true }), close: async () => { closed = true; },
  }) };
  const root = vaultWith("acme", HTTP_MCP);
  const r = await runMcpTool({ root, connector, secrets: fakeSecrets({ "acme__default__TOKEN": "s" }) }, "acme", "search", { query: "x" });
  expect(r).toEqual({ status: 502, body: "boom" });
  expect(closed).toBe(true);
});

test("stdio transport is deferred (throws before connecting)", async () => {
  const root = vaultWith("acme", STDIO_MCP);
  const connector: McpConnector = { connectHttp: async () => { throw new Error("should not connect"); } };
  await expect(runMcpTool({ root, connector, secrets: fakeSecrets({}) }, "acme", "search", {})).rejects.toThrow(/needs the sandbox/);
});

test("an action without remote_tool throws", async () => {
  const bad = HTTP_MCP.replace('search: { remote_tool: "acme_search", params: [{ name: query, required: true }] }', "search: { params: [{ name: query, required: true }] }");
  const root = vaultWith("acme", bad);
  const connector: McpConnector = { connectHttp: async () => { throw new Error("nope"); } };
  await expect(runMcpTool({ root, connector, secrets: fakeSecrets({ "acme__default__TOKEN": "s" }) }, "acme", "search", { query: "x" })).rejects.toThrow(/remote_tool/);
});
```

- [ ] **Step 3: Run — fail.** `npx vitest run test/mcpProxy.test.ts` → FAIL (module missing).

- [ ] **Step 4: Create `src/mcpProxy.ts`**
```ts
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
```

- [ ] **Step 5: Run — pass.** `npx vitest run test/mcpProxy.test.ts` → all green.

- [ ] **Step 6: Commit**
```bash
git add src/mcpProxy.ts test/mcpProxy.test.ts src/tools.ts
git commit -m "feat(#3b): mcp-proxy runMcpTool + injectable connector (http transport)"
```

---

### Task 2: Wire `mcp` into invoke + server + index

**Files:** Modify `src/invoke.ts`, `src/server.ts`, `src/index.ts`, `test/invoke.test.ts`.

- [ ] **Step 1: Flip the invoke test (TDD)**
Read `test/invoke.test.ts` around the `MCP` fixture (lines ~54-66) and the "mcp executor is inert" test (~68-70). Replace that test with two cases (adapt the `MCP` fixture to an http transport with a `remote_tool` + a connection, like `HTTP_MCP` in Task 1):
```ts
test("mcp executor errors clearly when no connector is configured", async () => {
  const root = vaultWith("mcp1", MCP);
  await expect(invoke({ root, secrets: fakeSecrets({}) }, { tool: "mcp1", action: "run" })).rejects.toThrow(/mcp executor not configured/);
});

test("mcp executor proxies via the connector", async () => {
  const root = vaultWith("mcp1", MCP);
  const connector = { connectHttp: async () => ({ callTool: async () => ({ content: { ok: true }, isError: false }), close: async () => {} }) };
  const r = await invoke({ root, secrets: fakeSecrets({ /* any required secret for MCP */ }), connector } as any, { tool: "mcp1", action: "run" });
  expect(r).toEqual({ status: 200, body: { ok: true } });
});
```
(If the existing `MCP` fixture has no `remote_tool`/http transport/connection, update it to a valid http-mcp manifest so the proxy path runs. Provide whatever `requires` secret it declares in `fakeSecrets`.)

- [ ] **Step 2: Run — fail.** `npx vitest run test/invoke.test.ts` → the new tests FAIL (still throws "not available yet").

- [ ] **Step 3: `src/invoke.ts` — dispatch + dep**
Add `connector?: import("./mcpProxy.js").McpConnector` to the `invoke` deps object type. Replace the mcp throw:
```ts
if (manifest.type === "mcp") {
  if (!deps.connector) throw new Error("mcp executor not configured");
  const { runMcpTool } = await import("./mcpProxy.js");
  return runMcpTool({ root: deps.root, connector: deps.connector, secrets: deps.secrets }, args.tool, args.action, params, args.connection);
}
```
(Keep it above the `http` handling, where the old mcp throw was.)

- [ ] **Step 4: `src/server.ts` — opts + invoke call**
- `buildMcpServer` opts type (line ~117): add `connector?: import("./mcpProxy.js").McpConnector`.
- The `invoke` closure (line ~162): pass `connector: opts.connector`.

- [ ] **Step 5: `src/index.ts` — inject the real connector**
- Import `realMcpConnector` from `./mcpProxy.js`.
- Line ~64 (`buildMcpServer(queryDeps, { …, docker: realDocker() })`): add `connector: realMcpConnector()`.
- Line ~94 (dashboard `invoke({ …, docker: realDocker() }, args)`): add `connector: realMcpConnector()`.

- [ ] **Step 6: Run — pass.** `npx vitest run test/invoke.test.ts` → green.

- [ ] **Step 7: Commit**
```bash
git add src/invoke.ts src/server.ts src/index.ts test/invoke.test.ts
git commit -m "feat(#3b): dispatch mcp tools to the proxy; wire the connector through server + index"
```

---

### Task 3: Integration test — real in-process StreamableHTTP MCP server

**Files:** Create `test/integration/mcpProxy.integration.test.ts`.

- [ ] **Step 1: Write the integration test**
Stand up a minimal real MCP server (mirror `src/server.ts`'s StreamableHTTP handling, lines ~178-214) with one `echo` tool, serve it on `express` at a random port, then proxy through `realMcpConnector()`:
```ts
import { afterEach, beforeEach, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { realMcpConnector } from "../../src/mcpProxy.js";

let server: Server; let url: string;

beforeEach(async () => {
  const app = express(); app.use(express.json());
  app.post("/mcp", async (req, res) => {
    const mcp = new McpServer({ name: "echo-server", version: "0.0.1" });
    // Register an echo tool. Use the same registration API server.ts uses (server.tool / registerTool);
    // read src/server.ts:118+ for the exact shape. The handler returns { content: [{ type: "text", text: msg }] }.
    mcp.tool("echo", { msg: z.string() }, async ({ msg }) => ({ content: [{ type: "text", text: msg }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  await new Promise<void>((r) => { server = app.listen(0, () => { url = `http://localhost:${(server.address() as any).port}/mcp`; r(); }); });
});
afterEach(() => server.close());

test("realMcpConnector proxies a real StreamableHTTP callTool", async () => {
  const client = await realMcpConnector().connectHttp({ url, headers: {}, timeoutMs: 10000 });
  try {
    const r = await client.callTool("echo", { msg: "hello geode" });
    // content is the SDK CallToolResult content array; assert the echoed text is present.
    expect(JSON.stringify(r.content)).toContain("hello geode");
    expect(r.isError).toBe(false);
  } finally { await client.close(); }
});
```
Adjust the `mcp.tool(...)` registration call to the exact API used in `src/server.ts` (check whether it's `server.tool(name, shape, handler)` or `server.registerTool(name, { inputSchema }, handler)`).

- [ ] **Step 2: Run — pass.** `npx vitest run test/integration/mcpProxy.integration.test.ts` → green (fully in-process, no network/Docker).

- [ ] **Step 3: Full suite + gate.** `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint src test` clean (0 errors).

- [ ] **Step 4: Commit**
```bash
git add test/integration/mcpProxy.integration.test.ts
git commit -m "test(#3b): integration — proxy a real in-process StreamableHTTP MCP server"
```

---

## Final verification
- `npx vitest run` green (unit mcpProxy + invoke flip + integration); `npx tsc --noEmit` clean; `npx eslint src test` clean.
- `invoke` on an `http`-transport `mcp` tool connects, calls `remote_tool`, returns `{ status, body }`; a `stdio` tool returns the clear "needs the sandbox (#3b-2)" error.

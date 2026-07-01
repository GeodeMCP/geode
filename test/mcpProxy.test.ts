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

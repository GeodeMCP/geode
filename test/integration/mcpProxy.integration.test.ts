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
    mcp.registerTool("echo", { inputSchema: { msg: z.string() } }, async ({ msg }) => ({ content: [{ type: "text", text: msg }] }));
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
    expect(JSON.stringify(r.content)).toContain("hello geode");
    expect(r.isError).toBe(false);
  } finally { await client.close(); }
});

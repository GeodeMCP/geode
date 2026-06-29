import { z, type ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EvalConfig, ToolName } from "./types.js";
import { makeHandlers } from "./tools.js";

const SCHEMAS: Record<ToolName, ZodRawShape> = {
  list_capabilities: { tool: z.string().optional() },
  search: { query: z.string() },
  read: { path: z.string() },
  query: { instruction: z.string() },
  remember: { content: z.string(), title: z.string().optional(), source: z.string().optional() },
  invoke: { tool: z.string(), action: z.string(), connection: z.string().optional(), params: z.record(z.string(), z.any()).optional() },
};

/** Builds an MCP server exposing exactly the tools in `config`, with its descriptions + instructions, over `root`. */
export function buildEvalServer(config: EvalConfig, root: string): McpServer {
  const server = new McpServer({ name: "geode-kernel", version: "0.1.0" }, { instructions: config.serverInstructions });
  const handlers = makeHandlers(root, config.listMode) as Record<string, (a: any) => Promise<string>>;
  for (const name of config.tools) {
    server.registerTool(
      name,
      { description: config.descriptions[name] ?? name, inputSchema: SCHEMAS[name] },
      async (args: unknown) => {
        try {
          const text = await handlers[name](args ?? {});
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: `${name} failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
        }
      },
    );
  }
  return server;
}

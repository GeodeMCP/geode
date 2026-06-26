import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ModelFn, ModelTool, CallToolFn } from "./caller.js";

/** Connects an in-process MCP client to `server`; returns its tools (as model defs) + server instructions. */
export async function connectInMemory(server: McpServer): Promise<{ client: Client; tools: ModelTool[]; instructions: string }> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "eval-caller", version: "0.1.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  return {
    client,
    instructions: client.getInstructions() ?? "",
    tools: tools.map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Record<string, unknown> })),
  };
}

/** Calls an MCP tool and flattens its content to text. */
export function mcpCallTool(client: Client): CallToolFn {
  return async (name, input) => {
    const r: any = await client.callTool({ name, arguments: input });
    return (r.content ?? []).map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n");
  };
}

/** Wraps the Anthropic Messages API as a ModelFn (tool-use, auto tool_choice). */
export function anthropicModel(client: Anthropic, model: string): ModelFn {
  return async ({ system, tools, messages }) => {
    const res = await client.messages.create({
      model, max_tokens: 1024, system,
      tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as any })),
      messages: messages as any,
    });
    let text = "";
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    return { text, toolCalls };
  };
}

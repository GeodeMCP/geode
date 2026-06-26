import type { Trace, LegResult } from "./types.js";

/** A tool as the model sees it (Anthropic tool-definition shape). */
export interface ModelTool { name: string; description: string; input_schema: Record<string, unknown> }
/** One model turn: prose plus zero or more tool calls. */
export interface ModelTurn { text: string; toolCalls: { id: string; name: string; input: Record<string, unknown> }[] }
/** Produces the next model turn given the running message history. */
export type ModelFn = (req: { system: string; tools: ModelTool[]; messages: Msg[] }) => Promise<ModelTurn>;
/** Executes a tool call against the MCP server, returning its text result. */
export type CallToolFn = (name: string, input: Record<string, unknown>) => Promise<string>;
/** A message in the running conversation (provider-neutral). */
export interface Msg { role: "user" | "assistant"; content: unknown }

/** Drives a caller conversation: model → tool calls → results → repeat, capping at maxTurns. */
export async function runCaller(opts: {
  tools: ModelTool[]; model: ModelFn; callTool: CallToolFn; system: string; prompt: string; maxTurns: number;
}): Promise<LegResult> {
  const messages: Msg[] = [{ role: "user", content: opts.prompt }];
  const trace: Trace = [];
  let finalText = "";
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const { text, toolCalls } = await opts.model({ system: opts.system, tools: opts.tools, messages });
    if (text) finalText = text;
    if (toolCalls.length === 0) break;
    const assistantContent = [
      ...(text ? [{ type: "text", text }] : []),
      ...toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
    ];
    messages.push({ role: "assistant", content: assistantContent });
    const results = [];
    for (const c of toolCalls) {
      let result: string;
      try { result = await opts.callTool(c.name, c.input); }
      catch (e) { result = `error: ${e instanceof Error ? e.message : String(e)}`; }
      trace.push({ name: c.name, args: c.input, result });
      results.push({ type: "tool_result", tool_use_id: c.id, content: result });
    }
    messages.push({ role: "user", content: results });
  }
  return { trace, finalText };
}

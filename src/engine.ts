export interface EngineEvent {
  type: "progress" | "result";
  text: string;
}

export interface EngineRunOptions {
  instruction: string;
  cwd: string;
  systemPrompt: string;
  model?: string;
  abortController: AbortController;
}

export type Engine = (opts: EngineRunOptions) => AsyncIterable<EngineEvent>;

// Pure mapping from an Agent SDK message to engine events (unit-tested).
export function mapMessage(message: any): EngineEvent[] {
  if (message?.type === "assistant" && message.message?.content) {
    const events: EngineEvent[] = [];
    for (const block of message.message.content) {
      if (typeof block?.text === "string" && block.text.trim()) events.push({ type: "progress", text: block.text });
      else if (typeof block?.name === "string") events.push({ type: "progress", text: `→ ${block.name}` });
    }
    return events;
  }
  if (message?.type === "result") {
    return [{ type: "result", text: typeof message.result === "string" ? message.result : "" }];
  }
  return [];
}

// Build the Agent SDK query options (pure; unit-tested). The system prompt uses the
// `claude_code` PRESET with our constitution APPENDED — NOT a bare string. A bare-string
// systemPrompt replaces Claude Code's built-in prompt, which includes the agent's working
// directory; without it the agent guesses its cwd (e.g. the home dir) and writes files to
// the wrong place, so nothing lands in the vault. (Diagnosed 2026-06-17.)
export function buildQueryOptions(opts: EngineRunOptions): Record<string, unknown> {
  return {
    cwd: opts.cwd,
    systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt },
    tools: { type: "preset", preset: "claude_code" },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: ["project"],
    abortController: opts.abortController,
    ...(opts.model ? { model: opts.model } : {}),
  };
}

// Live engine backed by the Claude Agent SDK. Integration-only (not unit-tested).
export const claudeAgentEngine: Engine = async function* (opts: EngineRunOptions): AsyncIterable<EngineEvent> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  for await (const message of query({ prompt: opts.instruction, options: buildQueryOptions(opts) } as any)) {
    for (const ev of mapMessage(message)) yield ev;
  }
};

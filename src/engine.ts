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

// A short, useful one-liner for a tool use: what the agent is actually doing
// (the command it runs, the file it touches) — not just the tool's name.
export function describeTool(name: string, input: any): string {
  const i = input ?? {};
  const clip = (s: string) => (s.length > 100 ? s.slice(0, 100) + "…" : s);
  if (name === "Bash" && typeof i.command === "string") return `Bash · ${clip(i.command)}`;
  if ((name === "Read" || name === "Write" || name === "Edit" || name === "NotebookEdit") && typeof i.file_path === "string") return `${name} · ${clip(i.file_path)}`;
  if ((name === "Glob" || name === "Grep") && typeof i.pattern === "string") return `${name} · ${clip(i.pattern)}`;
  return name;
}

// Pure mapping from an Agent SDK message to engine events (unit-tested).
export function mapMessage(message: any): EngineEvent[] {
  if (message?.type === "assistant" && message.message?.content) {
    const events: EngineEvent[] = [];
    for (const block of message.message.content) {
      if (typeof block?.text === "string" && block.text.trim()) events.push({ type: "progress", text: block.text });
      else if (typeof block?.name === "string") events.push({ type: "progress", text: `→ ${describeTool(block.name, block.input)}` });
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
  // Show vault-relative paths in step detail, not the absolute cwd. Handle the macOS
  // /tmp → /private/tmp symlink: strip the full "<cwd>/" prefix (optionally /private-prefixed).
  const esc = opts.cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = opts.cwd ? new RegExp(`(?:/private)?${esc}/`, "g") : null;
  const strip = (s: string) => (re ? s.replace(re, "") : s);
  for await (const message of query({ prompt: opts.instruction, options: buildQueryOptions(opts) } as any)) {
    for (const ev of mapMessage(message)) yield { type: ev.type, text: strip(ev.text) };
  }
};

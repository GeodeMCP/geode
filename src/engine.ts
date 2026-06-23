export interface EngineEvent {
  type: "progress" | "result";
  text: string;
  detail?: string; // for tool-use progress: the full content (command, file body, edit) to reveal on expand
}

export interface EngineRunOptions {
  instruction: string;
  cwd: string;
  systemPrompt: string;
  model?: string;
  abortController: AbortController;
}

export type Engine = (opts: EngineRunOptions) => AsyncIterable<EngineEvent>;

// A tool use → a short summary (what file/command, shown collapsed) + the full detail
// (the actual command / written content / edit, revealed when the step is expanded).
export function toolInfo(name: string, input: any): { summary: string; detail: string } {
  const i = input ?? {};
  const oneLine = (s: string, n = 64) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
  if (name === "Bash" && typeof i.command === "string") return { summary: oneLine(i.command), detail: i.command };
  if (name === "Write" && typeof i.file_path === "string") return { summary: i.file_path, detail: typeof i.content === "string" ? i.content : "" };
  if (name === "Edit" && typeof i.file_path === "string") {
    const minus = typeof i.old_string === "string" ? i.old_string.split("\n").map((l: string) => "- " + l).join("\n") : "";
    const plus = typeof i.new_string === "string" ? i.new_string.split("\n").map((l: string) => "+ " + l).join("\n") : "";
    return { summary: i.file_path, detail: [minus, plus].filter(Boolean).join("\n") };
  }
  if ((name === "Read" || name === "NotebookEdit") && typeof i.file_path === "string") return { summary: i.file_path, detail: "" };
  if ((name === "Glob" || name === "Grep") && typeof i.pattern === "string") return { summary: i.pattern, detail: "" };
  return { summary: "", detail: "" };
}

// Pure mapping from an Agent SDK message to engine events (unit-tested).
export function mapMessage(message: any): EngineEvent[] {
  if (message?.type === "assistant" && message.message?.content) {
    const events: EngineEvent[] = [];
    for (const block of message.message.content) {
      if (typeof block?.text === "string" && block.text.trim()) {
        events.push({ type: "progress", text: block.text });
      } else if (typeof block?.name === "string") {
        const { summary, detail } = toolInfo(block.name, block.input);
        const text = summary ? `→ ${block.name} · ${summary}` : `→ ${block.name}`;
        events.push(detail ? { type: "progress", text, detail } : { type: "progress", text });
      }
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
  // Show vault-relative paths, not the absolute cwd. Handle the macOS /tmp → /private/tmp
  // symlink: strip the full "<cwd>/" prefix (optionally /private-prefixed).
  const esc = opts.cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = opts.cwd ? new RegExp(`(?:/private)?${esc}/`, "g") : null;
  const strip = (s: string) => (re ? s.replace(re, "") : s);
  for await (const message of query({ prompt: opts.instruction, options: buildQueryOptions(opts) } as any)) {
    for (const ev of mapMessage(message)) {
      yield ev.detail !== undefined
        ? { type: ev.type, text: strip(ev.text), detail: strip(ev.detail) }
        : { type: ev.type, text: strip(ev.text) };
    }
  }
};

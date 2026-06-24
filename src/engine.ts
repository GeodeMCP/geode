export interface Todo { content: string; status: string }
export interface Metrics { durationMs: number; costUsd: number; tokens: number }

// Structured events the agent emits during a run. The dashboard renders each kind
// distinctly (prose bubble, thinking, grouped tool steps, live todo list, system notice);
// the MCP layer flattens them back to text via `eventText`.
export type ProgressEvent =
  | { type: "thinking"; text: string }
  | { type: "tool"; toolId: string; name: string; summary: string; detail?: string }
  | { type: "tool_result"; toolId: string; ok: boolean; output?: string }
  | { type: "todos"; items: Todo[] }
  | { type: "notice"; kind: "compact" | "memory" | "retry"; text: string }
  | { type: "text"; text: string };

export type ResultEvent = { type: "result"; text: string; metrics?: Metrics };
export type EngineEvent = ProgressEvent | ResultEvent;

export interface EngineRunOptions {
  instruction: string;
  cwd: string;
  systemPrompt: string;
  model?: string;
  abortController: AbortController;
}

export type Engine = (opts: EngineRunOptions) => AsyncIterable<EngineEvent>;

// A tool use → a short summary (what file/command, shown collapsed) + an optional input-derived
// detail to reveal on expand. detail is set only when the *input* carries the meaningful content
// (Write body, Edit diff); for Read/Bash/Grep the meaningful content is the OUTPUT, captured
// separately from the tool_result.
export function toolInfo(name: string, input: any): { summary: string; detail: string } {
  const i = input ?? {};
  const oneLine = (s: string, n = 64) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
  if (name === "Bash" && typeof i.command === "string") return { summary: oneLine(i.command), detail: "" };
  if (name === "Write" && typeof i.file_path === "string") return { summary: i.file_path, detail: typeof i.content === "string" ? i.content : "" };
  if ((name === "Edit" || name === "MultiEdit") && typeof i.file_path === "string") {
    const minus = typeof i.old_string === "string" ? i.old_string.split("\n").map((l: string) => "- " + l).join("\n") : "";
    const plus = typeof i.new_string === "string" ? i.new_string.split("\n").map((l: string) => "+ " + l).join("\n") : "";
    return { summary: i.file_path, detail: [minus, plus].filter(Boolean).join("\n") };
  }
  if ((name === "Read" || name === "NotebookEdit") && typeof i.file_path === "string") return { summary: i.file_path, detail: "" };
  if ((name === "Glob" || name === "Grep") && typeof i.pattern === "string") return { summary: i.pattern, detail: "" };
  if ((name === "WebFetch" || name === "WebSearch")) return { summary: oneLine(String(i.url ?? i.query ?? "")), detail: "" };
  return { summary: "", detail: "" };
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

// tool_result content is string | array of {type,text,...}. Flatten to text, capped so a giant
// file Read doesn't bloat the SSE stream.
function extractToolText(content: any): string | undefined {
  let s = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n") : "";
  s = s.trim();
  if (!s) return undefined;
  const MAX = 4000;
  return s.length > MAX ? s.slice(0, MAX) + "\n… (truncated)" : s;
}

function extractMetrics(message: any): Metrics | undefined {
  if (typeof message.duration_ms !== "number" && typeof message.total_cost_usd !== "number") return undefined;
  const u = message.usage ?? {};
  const tokens = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
  return { durationMs: Number(message.duration_ms) || 0, costUsd: Number(message.total_cost_usd) || 0, tokens };
}

// Pure mapping from an Agent SDK message to engine events (unit-tested).
export function mapMessage(message: any): EngineEvent[] {
  const t = message?.type;
  if (t === "assistant" && Array.isArray(message.message?.content)) {
    const events: EngineEvent[] = [];
    for (const block of message.message.content) {
      if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        events.push({ type: "thinking", text: block.thinking });
      } else if (typeof block?.text === "string" && block.text.trim()) {
        events.push({ type: "text", text: block.text });
      } else if (typeof block?.name === "string") {
        if (block.name === "TodoWrite" && Array.isArray(block.input?.todos)) {
          events.push({ type: "todos", items: block.input.todos.map((td: any) => ({ content: String(td?.content ?? ""), status: String(td?.status ?? "pending") })) });
        } else {
          const { summary, detail } = toolInfo(block.name, block.input);
          events.push(detail
            ? { type: "tool", toolId: String(block.id ?? ""), name: block.name, summary, detail }
            : { type: "tool", toolId: String(block.id ?? ""), name: block.name, summary });
        }
      }
    }
    return events;
  }
  if (t === "user" && Array.isArray(message.message?.content)) {
    const events: EngineEvent[] = [];
    for (const block of message.message.content) {
      if (block?.type === "tool_result") {
        const output = extractToolText(block.content);
        events.push(output !== undefined
          ? { type: "tool_result", toolId: String(block.tool_use_id ?? ""), ok: !block.is_error, output }
          : { type: "tool_result", toolId: String(block.tool_use_id ?? ""), ok: !block.is_error });
      }
    }
    return events;
  }
  if (t === "system") {
    if (message.subtype === "compact_boundary") {
      const m = message.compact_metadata ?? {};
      const text = typeof m.pre_tokens === "number"
        ? `context compacted · ${fmtTokens(m.pre_tokens)} → ${typeof m.post_tokens === "number" ? fmtTokens(m.post_tokens) : "…"} tokens`
        : "context compacted";
      return [{ type: "notice", kind: "compact", text }];
    }
    if (message.subtype === "memory_recall") {
      const n = Array.isArray(message.memories) ? message.memories.length : 0;
      return [{ type: "notice", kind: "memory", text: n ? `Recalled ${n} item${n > 1 ? "s" : ""} from memory` : "Recalled from memory" }];
    }
    if (message.subtype === "api_retry") {
      return [{ type: "notice", kind: "retry", text: `Retrying… (attempt ${message.attempt ?? 1}/${message.max_retries ?? "?"})` }];
    }
    return [];
  }
  if (t === "result") {
    const metrics = extractMetrics(message);
    return [metrics
      ? { type: "result", text: typeof message.result === "string" ? message.result : "", metrics }
      : { type: "result", text: typeof message.result === "string" ? message.result : "" }];
  }
  return [];
}

// Flatten a progress event back to a single line for the MCP progress channel (text-only).
// Returns "" for events the MCP transcript should skip (tool results, todos, thinking).
export function eventText(ev: ProgressEvent): string {
  switch (ev.type) {
    case "text": return ev.text;
    case "tool": return ev.summary ? `→ ${ev.name} · ${ev.summary}` : `→ ${ev.name}`;
    case "notice": return ev.text;
    default: return "";
  }
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
    // The vault agent runs non-interactively: there is no channel to answer a question mid-run, so
    // AskUserQuestion would just fail and the agent narrates a confusing "you skipped the question".
    // Remove it — the agent proceeds with a stated assumption instead (reinforced in the constitution).
    disallowedTools: ["AskUserQuestion"],
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
  const stripEvent = (ev: EngineEvent): EngineEvent => {
    switch (ev.type) {
      case "tool": return ev.detail !== undefined
        ? { ...ev, summary: strip(ev.summary), detail: strip(ev.detail) }
        : { ...ev, summary: strip(ev.summary) };
      case "tool_result": return ev.output !== undefined ? { ...ev, output: strip(ev.output) } : ev;
      case "text": case "thinking": case "notice": case "result": return { ...ev, text: strip(ev.text) };
      default: return ev;
    }
  };
  for await (const message of query({ prompt: opts.instruction, options: buildQueryOptions(opts) } as any)) {
    for (const ev of mapMessage(message)) yield stripEvent(ev);
  }
};

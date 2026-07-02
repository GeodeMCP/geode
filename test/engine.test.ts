import { expect, test } from "vitest";
import { mapMessage, buildQueryOptions, eventText } from "../src/engine.js";

test("maps assistant text blocks to text events", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ text: "working on it" }] } });
  expect(events).toEqual([{ type: "text", text: "working on it" }]);
});

test("maps a thinking block to a thinking event", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ type: "thinking", thinking: "let me check the structure" }] } });
  expect(events).toEqual([{ type: "thinking", text: "let me check the structure" }]);
});

test("maps tool-use blocks to a tool event with id + name", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ id: "t1", name: "Bash", input: { command: "git status" } }] } });
  expect(events).toEqual([{ type: "tool", toolId: "t1", name: "Bash", summary: "git status" }]);
});

test("Edit carries the diff as input-derived detail; Write carries its body", () => {
  expect(mapMessage({ type: "assistant", message: { content: [{ id: "e1", name: "Edit", input: { file_path: "notes.md", old_string: "a", new_string: "b" } }] } }))
    .toEqual([{ type: "tool", toolId: "e1", name: "Edit", summary: "notes.md", detail: "- a\n+ b" }]);
  expect(mapMessage({ type: "assistant", message: { content: [{ id: "w1", name: "Write", input: { file_path: "notes/hoi.md", content: "hello body" } }] } }))
    .toEqual([{ type: "tool", toolId: "w1", name: "Write", summary: "notes/hoi.md", detail: "hello body" }]);
  // Read carries no input detail (its content arrives via the tool_result)
  expect(mapMessage({ type: "assistant", message: { content: [{ id: "r1", name: "Read", input: { file_path: "index.md" } }] } }))
    .toEqual([{ type: "tool", toolId: "r1", name: "Read", summary: "index.md" }]);
});

test("TodoWrite becomes a todos event, not a tool step", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ id: "td", name: "TodoWrite", input: { todos: [{ content: "step one", status: "completed" }, { content: "step two", status: "in_progress" }] } }] } });
  expect(events).toEqual([{ type: "todos", items: [{ content: "step one", status: "completed" }, { content: "step two", status: "in_progress" }] }]);
});

test("maps tool_result blocks in a user message to tool_result events", () => {
  const events = mapMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "on branch main" }] } });
  expect(events).toEqual([{ type: "tool_result", toolId: "t1", ok: true, output: "on branch main" }]);
});

test("tool_result flags errors and flattens array content", () => {
  const events = mapMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: [{ type: "text", text: "boom" }] }] } });
  expect(events).toEqual([{ type: "tool_result", toolId: "t2", ok: false, output: "boom" }]);
});

test("maps compact_boundary / memory_recall / api_retry to notices", () => {
  expect(mapMessage({ type: "system", subtype: "compact_boundary", compact_metadata: { pre_tokens: 41000, post_tokens: 9000 } }))
    .toEqual([{ type: "notice", kind: "compact", text: "context compacted · 41k → 9k tokens" }]);
  expect(mapMessage({ type: "system", subtype: "memory_recall", memories: [{ path: "/a" }, { path: "/b" }] }))
    .toEqual([{ type: "notice", kind: "memory", text: "Recalled 2 items from memory" }]);
  expect(mapMessage({ type: "system", subtype: "api_retry", attempt: 2, max_retries: 5 }))
    .toEqual([{ type: "notice", kind: "retry", text: "Retrying… (attempt 2/5)" }]);
});

test("maps a result message to a result event with metrics", () => {
  const events = mapMessage({ type: "result", result: "all done", duration_ms: 4600, total_cost_usd: 0.012, usage: { input_tokens: 2000, output_tokens: 1100 } });
  expect(events).toEqual([{ type: "result", text: "all done", metrics: { durationMs: 4600, costUsd: 0.012, tokens: 3100 } }]);
});

test("result without metrics omits the field", () => {
  expect(mapMessage({ type: "result", result: "ok" })).toEqual([{ type: "result", text: "ok" }]);
});

test("ignores unknown / unhandled system message types", () => {
  expect(mapMessage({ type: "system", subtype: "init" })).toEqual([]);
  expect(mapMessage({ type: "stream_event" })).toEqual([]);
});

test("eventText flattens progress events for the MCP channel", () => {
  expect(eventText({ type: "text", text: "hi" })).toBe("hi");
  expect(eventText({ type: "tool", toolId: "x", name: "Bash", summary: "ls" })).toBe("→ Bash · ls");
  expect(eventText({ type: "notice", kind: "compact", text: "context compacted" })).toBe("context compacted");
  expect(eventText({ type: "tool_result", toolId: "x", ok: true })).toBe("");
  expect(eventText({ type: "todos", items: [] })).toBe("");
  expect(eventText({ type: "thinking", text: "hmm" })).toBe("");
});

test("buildQueryOptions appends the constitution to the claude_code preset (so the agent knows its cwd)", () => {
  const o = buildQueryOptions({ instruction: "x", cwd: "/vault", systemPrompt: "RULES", abortController: new AbortController() });
  expect(o.cwd).toBe("/vault");
  expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "RULES" });
  expect(o.tools).toEqual({ type: "preset", preset: "claude_code" });
  expect(o.permissionMode).toBe("bypassPermissions");
  // non-interactive: the agent must not reach for the interactive question tool
  expect(o.disallowedTools).toContain("AskUserQuestion");
});

test("buildQueryOptions includes model only when provided", () => {
  const base = { instruction: "x", cwd: "/v", systemPrompt: "r", abortController: new AbortController() };
  expect("model" in buildQueryOptions(base)).toBe(false);
  expect(buildQueryOptions({ ...base, model: "m" }).model).toBe("m");
});

const sandboxedOpts = () => buildQueryOptions({
  instruction: "hi", cwd: "/vault", systemPrompt: "SYS", abortController: new AbortController(),
  sandbox: {
    enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
    filesystem: { allowWrite: ["/vault"] }, network: { allowedDomains: ["api.anthropic.com"] },
  },
});

test("a sandboxed run enforces: it forwards the sandbox, uses permissionMode 'default', never bypasses, and carries a handler", () => {
  const opts = sandboxedOpts();
  expect(opts.sandbox).toMatchObject({ enabled: true, filesystem: { allowWrite: ["/vault"] } });
  // The OS sandbox derives its file/network boundary from permission rules; bypassPermissions would
  // skip exactly those. So a sandboxed run must NOT bypass — and must attach a programmatic handler
  // (non-interactive: it decides every tool call without prompting).
  expect(opts.permissionMode).toBe("default");
  expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
  expect(typeof opts.canUseTool).toBe("function");
});

test("the sandboxed run's permission handler denies tool egress and confines writes to the vault", async () => {
  const can = sandboxedOpts().canUseTool as (n: string, i: Record<string, unknown>) => Promise<{ behavior: string }>;
  expect((await can("WebFetch", { url: "https://evil.com" })).behavior).toBe("deny");
  expect((await can("Write", { file_path: "/etc/passwd" })).behavior).toBe("deny");
  expect((await can("Write", { file_path: "notes/ok.md" })).behavior).toBe("allow");
});

test("an unsandboxed (dev) run stays unconfined: bypassPermissions, no sandbox, no handler", () => {
  const opts = buildQueryOptions({ instruction: "hi", cwd: "/vault", systemPrompt: "SYS", abortController: new AbortController() });
  expect("sandbox" in opts).toBe(false);
  expect(opts.permissionMode).toBe("bypassPermissions");
  expect(opts.allowDangerouslySkipPermissions).toBe(true);
  expect("canUseTool" in opts).toBe(false);
});

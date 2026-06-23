import { expect, test } from "vitest";
import { mapMessage, buildQueryOptions } from "../src/engine.js";

test("maps assistant text blocks to progress events", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ text: "working on it" }] } });
  expect(events).toEqual([{ type: "progress", text: "working on it" }]);
});

test("maps tool-use blocks to a progress marker", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ name: "Bash" }] } });
  expect(events).toEqual([{ type: "progress", text: "→ Bash" }]);
});

test("tool-use includes a useful detail from the input (command / file / pattern)", () => {
  expect(mapMessage({ type: "assistant", message: { content: [{ name: "Bash", input: { command: "git status" } }] } }))
    .toEqual([{ type: "progress", text: "→ Bash · git status" }]);
  expect(mapMessage({ type: "assistant", message: { content: [{ name: "Write", input: { file_path: "notes/hoi.md" } }] } }))
    .toEqual([{ type: "progress", text: "→ Write · notes/hoi.md" }]);
});

test("maps a result message to a single result event", () => {
  const events = mapMessage({ type: "result", result: "all done" });
  expect(events).toEqual([{ type: "result", text: "all done" }]);
});

test("ignores unknown message types", () => {
  expect(mapMessage({ type: "system" })).toEqual([]);
});

test("buildQueryOptions appends the constitution to the claude_code preset (so the agent knows its cwd)", () => {
  const o = buildQueryOptions({ instruction: "x", cwd: "/vault", systemPrompt: "RULES", abortController: new AbortController() });
  expect(o.cwd).toBe("/vault");
  expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "RULES" });
  expect(o.tools).toEqual({ type: "preset", preset: "claude_code" });
  expect(o.permissionMode).toBe("bypassPermissions");
});

test("buildQueryOptions includes model only when provided", () => {
  const base = { instruction: "x", cwd: "/v", systemPrompt: "r", abortController: new AbortController() };
  expect("model" in buildQueryOptions(base)).toBe(false);
  expect(buildQueryOptions({ ...base, model: "m" }).model).toBe("m");
});

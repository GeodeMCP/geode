import { expect, test } from "vitest";
import { createMcpActivity, toolFromBody } from "../src/mcpActivity.js";

test("toolFromBody maps tools/call to the tool name, other methods to the method, junk to null", () => {
  expect(toolFromBody({ method: "tools/call", params: { name: "query" } })).toBe("query");
  expect(toolFromBody({ method: "tools/list" })).toBe("tools/list");
  expect(toolFromBody({ method: "initialize" })).toBe("initialize");
  expect(toolFromBody(null)).toBeNull();
  expect(toolFromBody([{ method: "tools/call" }])).toBeNull();
  expect(toolFromBody({ params: { name: "x" } })).toBeNull();
});

test("createMcpActivity records last time/tool and a running count; a null tool keeps the previous tool", () => {
  let t = 0;
  const a = createMcpActivity(() => `2026-01-01T00:00:0${t}Z`);
  expect(a.snapshot()).toEqual({ lastAt: null, lastTool: null, count: 0 });
  t = 1; a.record("query");
  expect(a.snapshot()).toEqual({ lastAt: "2026-01-01T00:00:01Z", lastTool: "query", count: 1 });
  t = 2; a.record(null);
  expect(a.snapshot()).toEqual({ lastAt: "2026-01-01T00:00:02Z", lastTool: "query", count: 2 });
});

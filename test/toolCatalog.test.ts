import { expect, test } from "vitest";
import { TOOL_CATALOG } from "../src/toolCatalog.js";

test("catalog lists exactly the four MCP tools", () => {
  expect(TOOL_CATALOG.map((t) => t.name)).toEqual(["query", "remember", "list_capabilities", "invoke"]);
});

test("every tool has a non-empty description and well-formed params", () => {
  for (const t of TOOL_CATALOG) {
    expect(t.description.trim().length).toBeGreaterThan(0);
    for (const p of t.params) {
      expect(p.name).toBeTruthy();
      expect(typeof p.required).toBe("boolean");
    }
  }
});

test("query takes instruction; list_capabilities takes none; invoke takes integration+action+params", () => {
  const byName = Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, t]));
  expect(byName.query.params.map((p) => p.name)).toEqual(["instruction"]);
  expect(byName.list_capabilities.params).toEqual([]);
  expect(byName.invoke.params.map((p) => p.name)).toEqual(["integration", "action", "params"]);
});

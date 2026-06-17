import { expect, test } from "vitest";
import { mapMessage } from "../src/engine.js";

test("maps assistant text blocks to progress events", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ text: "working on it" }] } });
  expect(events).toEqual([{ type: "progress", text: "working on it" }]);
});

test("maps tool-use blocks to a progress marker", () => {
  const events = mapMessage({ type: "assistant", message: { content: [{ name: "Bash" }] } });
  expect(events).toEqual([{ type: "progress", text: "→ Bash" }]);
});

test("maps a result message to a single result event", () => {
  const events = mapMessage({ type: "result", result: "all done" });
  expect(events).toEqual([{ type: "result", text: "all done" }]);
});

test("ignores unknown message types", () => {
  expect(mapMessage({ type: "system" })).toEqual([]);
});

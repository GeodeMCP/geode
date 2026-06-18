import { expect, test } from "vitest";
import { parseSseChunk } from "./api";

test("parseSseChunk yields complete events and keeps the remainder", () => {
  const { events, rest } = parseSseChunk('event: progress\ndata: {"message":"hi"}\n\nevent: res');
  expect(events).toEqual([{ event: "progress", data: { message: "hi" } }]);
  expect(rest).toBe("event: res");
});

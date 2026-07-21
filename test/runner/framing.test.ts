import { describe, it, expect } from "vitest";
import { encodeLine, createLineDecoder } from "../../src/runner/framing.js";

describe("framing", () => {
  it("encodes a message as one JSON line", () => {
    expect(encodeLine({ a: 1 })).toBe('{"a":1}\n');
  });
  it("decodes complete lines and buffers a partial remainder", () => {
    const decode = createLineDecoder();
    expect(decode('{"a":1}\n{"b":2}\n{"c":')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(decode('3}\n')).toEqual([{ c: 3 }]);
  });
  it("returns nothing for an empty or whitespace-only flush", () => {
    const decode = createLineDecoder();
    expect(decode("")).toEqual([]);
  });
});

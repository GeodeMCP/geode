import { describe, it, expect } from "vitest";
import { geodeTheme, geodeHighlight } from "./editorTheme";

describe("editorTheme", () => {
  it("exports CodeMirror extensions", () => {
    expect(geodeTheme).toBeDefined();
    expect(geodeHighlight).toBeDefined();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CodeEditor } from "./CodeEditor";

afterEach(cleanup);

describe("CodeEditor", () => {
  it("mounts a CodeMirror editor", () => {
    const { container } = render(<CodeEditor value="hello" kind="text" editable={false} />);
    expect(container.querySelector(".cm-host .cm-editor")).toBeTruthy();
  });
  it("is non-editable in read-only mode", () => {
    const { container } = render(<CodeEditor value="x" kind="json" editable={false} />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });
  it("is editable in edit mode", () => {
    const { container } = render(<CodeEditor value="x" kind="json" editable onChange={() => {}} />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Viewer } from "./Viewer";

afterEach(cleanup);

const noop = () => {};
const base = { diff: "", dirty: false, compose: null, onCommit: noop, onDiscard: noop, onSave: noop };

describe("Viewer", () => {
  it("renders Markdown formatted by default with a Formatted/Source toggle", () => {
    const { container, getByText } = render(
      <Viewer {...base} path="notes/a.md" content={"# Hello\n\nbody"} />,
    );
    expect(container.querySelector(".doc.md h1")?.textContent).toBe("Hello");
    expect(container.querySelector(".seg")).toBeTruthy();
    fireEvent.click(getByText("Source"));
    expect(container.querySelector(".doc.md")).toBeFalsy();
    expect(container.querySelector(".cm-host")).toBeTruthy();
  });

  it("renders JSON as a code view with no toggle", () => {
    const { container } = render(
      <Viewer {...base} path="a.json" content={'{"a":1}'} />,
    );
    expect(container.querySelector(".seg")).toBeFalsy();
    expect(container.querySelector(".doc.md")).toBeFalsy();
    expect(container.querySelector(".cm-host")).toBeTruthy();
  });

  it("enters the editor on Edit", () => {
    const { container, getByText } = render(
      <Viewer {...base} path="a.json" content={"{}"} />,
    );
    fireEvent.click(getByText("Edit"));
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    expect(getByText("Save")).toBeTruthy();
  });

  it("returns to the formatted view after saving a Markdown file edited from Source", () => {
    const { container, getByText } = render(
      <Viewer {...base} path="notes/a.md" content={"# Hello\n\nbody"} />,
    );
    fireEvent.click(getByText("Source"));   // showSource = true
    fireEvent.click(getByText("Edit"));     // enter editor
    fireEvent.click(getByText("Save"));     // save → should reset to formatted
    expect(container.querySelector(".doc.md h1")?.textContent).toBe("Hello");
  });

  it("shows the git diff for a dirty file", () => {
    const { container } = render(
      <Viewer {...base} path="a.md" content={"x"} dirty diff={"@@ -1 +1 @@\n+x"} />,
    );
    expect(container.querySelector(".pre")).toBeTruthy();
    expect(container.querySelector(".cm-host")).toBeFalsy();
  });
});

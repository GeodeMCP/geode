import { afterEach, expect, it, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileTree } from "./FileTree";
import type { TreeNode } from "../api";

afterEach(cleanup);

const tree: TreeNode[] = [
  { name: "clients", path: "clients", type: "dir", children: [
    { name: "acme", path: "clients/acme", type: "dir", children: [
      { name: "deep.md", path: "clients/acme/deep.md", type: "file" },
    ] },
    { name: "x.md", path: "clients/x.md", type: "file" },
  ] },
  { name: "index.md", path: "index.md", type: "file" },
];
const status = { modified: ["index.md"], created: [] };
const noop = () => {};

test("renders nested files/folders; folders collapse and expand", () => {
  render(<FileTree tree={tree} status={status} selected={null} onSelect={noop} onCreate={noop} onDelete={noop} />);
  for (const t of ["clients", "acme", "deep.md", "x.md", "index.md"]) expect(screen.getByText(t)).toBeTruthy();
  fireEvent.click(screen.getByText("clients"));            // collapse top folder
  expect(screen.queryByText("acme")).toBeNull();
  expect(screen.queryByText("deep.md")).toBeNull();
  expect(screen.getByText("index.md")).toBeTruthy();       // sibling unaffected
  fireEvent.click(screen.getByText("clients"));            // expand again
  expect(screen.getByText("deep.md")).toBeTruthy();
});

test("selecting a file calls onSelect; a modified file shows a 'modified' pill", () => {
  let sel = "";
  render(<FileTree tree={tree} status={status} selected={null} onSelect={(p) => (sel = p)} onCreate={noop} onDelete={noop} />);
  fireEvent.click(screen.getByText("index.md"));
  expect(sel).toBe("index.md");
  expect(screen.getByText("modified")).toBeTruthy();
});

test("delete asks for confirmation, then calls onDelete with the path", () => {
  let deleted = "";
  render(<FileTree tree={tree} status={status} selected={null} onSelect={noop} onCreate={noop} onDelete={(p) => (deleted = p)} />);
  fireEvent.click(screen.getByTitle("Delete index.md"));   // trash → confirm
  expect(screen.getByText("Cancel")).toBeTruthy();
  fireEvent.click(screen.getByText("Delete"));             // confirm
  expect(deleted).toBe("index.md");
});

it("opens and closes the new-file row", () => {
  const onCreate = vi.fn();
  const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
    <FileTree tree={[]} status={{ modified: [], created: [] }} selected={null}
      onSelect={() => {}} onCreate={onCreate} onDelete={() => {}} />,
  );
  fireEvent.click(getByText("+ New"));
  const input = getByPlaceholderText("path/to/note");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(queryByPlaceholderText("path/to/note")).toBeNull();
});

it("creates on Enter and cancels on blur-when-empty", () => {
  const onCreate = vi.fn();
  const { getByText, getByPlaceholderText, getByTitle, queryByPlaceholderText } = render(
    <FileTree tree={[]} status={{ modified: [], created: [] }} selected={null}
      onSelect={() => {}} onCreate={onCreate} onDelete={() => {}} />,
  );
  fireEvent.click(getByText("+ New"));
  const input = getByPlaceholderText("path/to/note");
  fireEvent.change(input, { target: { value: "notes/x" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCreate).toHaveBeenCalledWith("notes/x");

  fireEvent.click(getByText("+ New"));
  expect(getByTitle("Cancel")).toBeTruthy();
  fireEvent.blur(getByPlaceholderText("path/to/note"));
  expect(queryByPlaceholderText("path/to/note")).toBeNull();
});

it("renders a tool icon for a tool manifest row but not for a note row", () => {
  const toolTree: TreeNode[] = [
    { name: "notes", path: "notes", type: "dir", children: [
      { name: "a.md", path: "notes/a.md", type: "file" },
    ] },
    { name: "tools", path: "tools", type: "dir", children: [
      { name: "cb", path: "tools/cb", type: "dir", children: [
        { name: "TOOL.md", path: "tools/cb/TOOL.md", type: "file" },
      ] },
    ] },
  ];
  const { container } = render(
    <FileTree tree={toolTree} status={{ modified: [], created: [] }} selected={null}
      onSelect={noop} onCreate={noop} onDelete={noop} />,
  );
  const toolIcon = container.querySelector(".ic.tool");
  expect(toolIcon).toBeTruthy();
  const toolRow = screen.getByLabelText("TOOL.md");
  expect(toolRow.querySelector(".ic.tool")).toBeTruthy();
  const noteRow = screen.getByLabelText("a.md");
  expect(noteRow.querySelector(".ic.tool")).toBeFalsy();
});

it("keeps the new-file row open when blurred with text", () => {
  const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
    <FileTree tree={[]} status={{ modified: [], created: [] }} selected={null}
      onSelect={() => {}} onCreate={() => {}} onDelete={() => {}} />,
  );
  fireEvent.click(getByText("+ New"));
  const input = getByPlaceholderText("path/to/note");
  fireEvent.change(input, { target: { value: "draft" } });
  fireEvent.blur(input);
  expect(queryByPlaceholderText("path/to/note")).not.toBeNull();
});

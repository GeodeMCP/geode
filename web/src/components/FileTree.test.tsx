import { afterEach, beforeEach, expect, it, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileTree } from "./FileTree";
import type { TreeNode } from "../api";

afterEach(cleanup);
beforeEach(() => localStorage.clear()); // folders start collapsed (D1) with a clean expand-state each test

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
  // folders start collapsed (D1): top-level dirs + root files show, nested items hidden
  for (const t of ["clients", "index.md"]) expect(screen.getByText(t)).toBeTruthy();
  expect(screen.queryByText("acme")).toBeNull();
  fireEvent.click(screen.getByText("clients"));            // expand top folder
  for (const t of ["acme", "x.md"]) expect(screen.getByText(t)).toBeTruthy();
  fireEvent.click(screen.getByText("acme"));               // expand nested folder
  expect(screen.getByText("deep.md")).toBeTruthy();
  fireEvent.click(screen.getByText("clients"));            // collapse top again
  expect(screen.queryByText("acme")).toBeNull();
  expect(screen.getByText("index.md")).toBeTruthy();       // sibling unaffected
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
  // expand folders (collapsed by default) to reveal the nested rows
  fireEvent.click(screen.getByText("notes"));
  fireEvent.click(screen.getByText("tools"));
  fireEvent.click(screen.getByText("cb"));
  const toolIcon = container.querySelector(".ic.tool");
  expect(toolIcon).toBeTruthy();
  const toolRow = screen.getByLabelText("TOOL.md");
  expect(toolRow.querySelector(".ic.tool")).toBeTruthy();
  const noteRow = screen.getByLabelText("a.md");
  expect(noteRow.querySelector(".ic.tool")).toBeFalsy();
});

it("dims artifact rows and suppresses their trash button", () => {
  const artTree: TreeNode[] = [
    { name: "notes", path: "notes", type: "dir", children: [
      { name: "a.md", path: "notes/a.md", type: "file" },
    ] },
    { name: "artifacts", path: "artifacts", type: "dir", children: [
      { name: "report.md", path: "artifacts/report.md", type: "file" },
    ] },
  ];
  render(<FileTree tree={artTree} status={{ modified: [], created: [] }} selected={null}
    onSelect={noop} onCreate={noop} onDelete={noop} />);
  // expand folders (collapsed by default) to reveal the nested rows
  fireEvent.click(screen.getByText("notes"));
  fireEvent.click(screen.getByText("artifacts"));
  const artRow = screen.getByLabelText("report.md");
  expect(artRow.className).toContain("gen");
  expect(artRow.querySelector(".del-btn")).toBeFalsy();
  const noteRow = screen.getByLabelText("a.md");
  expect(noteRow.className).not.toContain("gen");
  expect(noteRow.querySelector(".del-btn")).toBeTruthy();
});

it("suppresses the trash button on the structural folders (tools/backlog) but not their contents or user folders", () => {
  const t: TreeNode[] = [
    { name: "tools", path: "tools", type: "dir", children: [
      { name: "cb", path: "tools/cb", type: "dir", children: [] },
    ] },
    { name: "backlog", path: "backlog", type: "dir", children: [
      { name: "gap.md", path: "backlog/gap.md", type: "file" },
    ] },
    { name: "notes", path: "notes", type: "dir", children: [] },
    { name: "business", path: "business", type: "dir", children: [] },
  ];
  render(<FileTree tree={t} status={{ modified: [], created: [] }} selected={null}
    onSelect={noop} onCreate={noop} onDelete={noop} />);
  for (const f of ["tools", "backlog"]) {
    expect(screen.getByLabelText(f).querySelector(".del-btn")).toBeFalsy();
  }
  // user-owned folders (incl. notes) are deletable
  for (const f of ["notes", "business"]) {
    expect(screen.getByLabelText(f).querySelector(".del-btn")).toBeTruthy();
  }
  // contents of structural folders stay deletable
  fireEvent.click(screen.getByText("backlog"));
  expect(screen.getByLabelText("gap.md").querySelector(".del-btn")).toBeTruthy();
});

it("gives backlog its own icon and tools the tool icon; notes and user folders use the generic folder icon", () => {
  const t: TreeNode[] = [
    { name: "backlog", path: "backlog", type: "dir", children: [] },
    { name: "notes", path: "notes", type: "dir", children: [] },
    { name: "tools", path: "tools", type: "dir", children: [] },
    { name: "business", path: "business", type: "dir", children: [] },
  ];
  render(<FileTree tree={t} status={{ modified: [], created: [] }} selected={null}
    onSelect={noop} onCreate={noop} onDelete={noop} />);
  expect(screen.getByLabelText("backlog").querySelector(".ic.backlog")).toBeTruthy();
  expect(screen.getByLabelText("tools").querySelector(".ic.tool")).toBeTruthy();
  // notes and free-form folders carry no special icon (generic folder glyph)
  expect(screen.getByLabelText("notes").querySelector(".ic.backlog, .ic.tool")).toBeFalsy();
  expect(screen.getByLabelText("business").querySelector(".ic.backlog, .ic.tool")).toBeFalsy();
});

it("gives index.md, log.md and AGENTS.md their own green kernel-file icons; ordinary files keep the generic icon", () => {
  const t: TreeNode[] = [
    { name: "index.md", path: "index.md", type: "file" },
    { name: "log.md", path: "log.md", type: "file" },
    { name: "AGENTS.md", path: "AGENTS.md", type: "file" },
    { name: "notes", path: "notes", type: "dir", children: [
      { name: "plain.md", path: "notes/plain.md", type: "file" },
    ] },
  ];
  render(<FileTree tree={t} status={{ modified: [], created: [] }} selected={null}
    onSelect={noop} onCreate={noop} onDelete={noop} />);
  expect(screen.getByLabelText("index.md").querySelector(".ic.index")).toBeTruthy();
  expect(screen.getByLabelText("log.md").querySelector(".ic.log")).toBeTruthy();
  expect(screen.getByLabelText("AGENTS.md").querySelector(".ic.agents")).toBeTruthy();
  fireEvent.click(screen.getByText("notes"));
  expect(screen.getByLabelText("plain.md").querySelector(".ic.index, .ic.log, .ic.agents")).toBeFalsy();
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

import { afterEach, expect, test } from "vitest";
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
  render(<FileTree tree={tree} status={status} selected={null} onSelect={noop} onCreate={noop} />);
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
  render(<FileTree tree={tree} status={status} selected={null} onSelect={(p) => (sel = p)} onCreate={noop} />);
  fireEvent.click(screen.getByText("index.md"));
  expect(sel).toBe("index.md");
  expect(screen.getByText("modified")).toBeTruthy();
});

import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../src/workspace.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-ws-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("uncommittedChanges lists working-tree changes; fileContent + diff reflect edits", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\noriginal\n");
  await ws.commitAll("seed");
  // edit + add a new file (uncommitted)
  writeFileSync(join(root, "index.md"), "# Index\nedited\n");
  writeFileSync(join(root, "note.md"), "new\n");
  const changes = await ws.uncommittedChanges();
  expect(changes.sort()).toEqual(["index.md", "note.md"]);
  expect(await ws.fileContent("index.md")).toContain("edited");
  expect(await ws.diff("index.md")).toContain("+edited");
  expect(await ws.statusPorcelain()).toContain("index.md");
});

test("fileContent rejects path traversal", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  await expect(ws.fileContent("../secret")).rejects.toThrow(/outside/);
});

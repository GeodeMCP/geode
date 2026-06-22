import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { symlinkSync } from "node:fs";
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

test("fileContent rejects a symlink that escapes the workspace, and machinery dirs", async () => {
  const ws = createWorkspace(root); await ws.init();
  symlinkSync("/etc/hosts", join(root, "escape.md"));
  await expect(ws.fileContent("escape.md")).rejects.toThrow(/outside|not allowed/);
  await expect(ws.fileContent(".git/config")).rejects.toThrow(/not allowed/);
});

test("diff shows a newly-created (untracked) file as additions", async () => {
  const ws = createWorkspace(root); await ws.init();
  writeFileSync(join(root, "index.md"), "# Index\n"); await ws.commitAll("seed");
  writeFileSync(join(root, "fresh.md"), "brand new line\n");
  expect(await ws.diff("fresh.md")).toContain("brand new line");
});

test("writeFile writes a knowledge file (creating parent dirs) and rejects machinery/traversal", async () => {
  const ws = createWorkspace(root); await ws.init();
  await ws.writeFile("notes/new.md", "# Hi\nbody\n");
  expect(await ws.fileContent("notes/new.md")).toContain("# Hi");
  await expect(ws.writeFile("../escape.md", "x")).rejects.toThrow(/outside|not allowed/);
  await expect(ws.writeFile(".git/hooks/evil", "x")).rejects.toThrow(/not allowed/);
  await expect(ws.writeFile("integrations/x/manifest.json", "{}")).rejects.toThrow(/not allowed/);
});

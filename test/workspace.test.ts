import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../src/workspace.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-ws-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("init creates a repo with an initial commit and is clean", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  expect(await ws.isClean()).toBe(true);
  expect(await ws.head()).toMatch(/^[0-9a-f]{40}$/);
});

test("commitAll commits changes and lists touched files; reset undoes them", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  const before = await ws.head();

  writeFileSync(join(root, "note.md"), "hello");
  const commit = await ws.commitAll("delegate: add note");
  expect(commit).not.toBeNull();
  expect(await ws.isClean()).toBe(true);
  expect(await ws.changedFilesSince(before)).toContain("note.md");

  writeFileSync(join(root, "dirty.md"), "uncommitted");
  expect(await ws.isClean()).toBe(false);
  await ws.resetToHead();
  expect(await ws.isClean()).toBe(true);
});

test("commitAll returns null when there is nothing to commit", async () => {
  const ws = createWorkspace(root);
  await ws.init();
  expect(await ws.commitAll("noop")).toBeNull();
});

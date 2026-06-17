import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { find } from "../src/find.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-find-"));
  mkdirSync(join(root, "brand"));
  writeFileSync(join(root, "AGENTS.md"), "# schema");
  writeFileSync(join(root, "brand", "voice.md"), "Direct, warm.\nNo jargon.");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("lists a directory when path is a folder", async () => {
  const res = await find(root, { path: "." });
  expect(res.kind).toBe("list");
  expect(res.entries).toEqual(expect.arrayContaining(["AGENTS.md", "brand/"]));
});

test("reads a file when path is a file", async () => {
  const res = await find(root, { path: "brand/voice.md" });
  expect(res.kind).toBe("read");
  expect(res.content).toContain("Direct, warm.");
});

test("searches file contents when query is given", async () => {
  const res = await find(root, { query: "jargon" });
  expect(res.kind).toBe("search");
  expect(res.hits[0].path).toBe("brand/voice.md");
  expect(res.hits[0].line).toContain("No jargon.");
});

test("rejects path traversal outside the workspace", async () => {
  await expect(find(root, { path: "../../etc/passwd" })).rejects.toThrow(/outside workspace/);
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { findStrayWikilinks } from "../src/lint.js";

test("findStrayWikilinks finds pages still using [[wikilink]] syntax, skipping generated dirs", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-lint-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "notes/a.md"), "See [[foo]] and [[bar]].\n");
  writeFileSync(join(root, "notes/b.md"), "See [x](./a.md) instead.\n");
  mkdirSync(join(root, ".geode"), { recursive: true });
  writeFileSync(join(root, ".geode/graph.json"), '{"note": "[[x]]"}\n');

  const result = await findStrayWikilinks(root);

  expect(result).toEqual([{ path: "notes/a.md", count: 2 }]);
});

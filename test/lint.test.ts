import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { findStrayWikilinks, findBrokenLinks, findOrphanNodes, lintVault } from "../src/lint.js";
import type { VaultGraph } from "../src/graph.js";

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

test("findBrokenLinks flags relative links whose target file is missing, skipping external/anchor links", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-lint-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(
    join(root, "notes/a.md"),
    "[ok](./b.md) [dead](./missing.md) [ext](https://example.com) [anchor](#top) [withsec](./b.md#part)\n"
  );
  writeFileSync(join(root, "notes/b.md"), "b\n");

  const result = await findBrokenLinks(root);

  expect(result).toEqual([{ path: "notes/a.md", link: "./missing.md" }]);
});

test("findOrphanNodes flags reference/sop nodes with no edges, excluding tool and gap nodes", () => {
  const graph: VaultGraph = {
    nodes: [
      { id: "s1", type: "sop", title: "s1", description: "", domain: "", path: "s1.md" },
      { id: "r1", type: "reference", title: "r1", description: "", domain: "", path: "r1.md" },
      { id: "t1", type: "tool", title: "t1", description: "", domain: "", path: "tools/t1/TOOL.md" },
      { id: "g1", type: "gap", title: "g1", description: "", domain: "", path: "g1.md" },
    ],
    edges: [{ from: "s1", to: "tools/t1", type: "uses" }],
  };

  const result = findOrphanNodes(graph);

  expect(result).toEqual([{ id: "r1", path: "r1.md" }]);
});

test("lintVault aggregates stray wikilinks, orphans, and broken links for a vault", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-lint-"));
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "notes/a.md"), "See [[foo]].\n");
  const secrets = { get: async () => null };

  const health = await lintVault(root, secrets);

  expect(Array.isArray(health.strayWikilinks)).toBe(true);
  expect(Array.isArray(health.orphans)).toBe(true);
  expect(Array.isArray(health.brokenLinks)).toBe(true);
});

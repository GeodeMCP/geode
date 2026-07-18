import { expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerateArtifacts } from "../src/rebuild.js";

test("regenerateArtifacts writes graph.json + index.md and returns the graph", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-rebuild-"));
  writeFileSync(join(root, "note.md"), "---\ntype: note\ntitle: A Note\ndescription: hi\n---\nbody\n");
  const graph = await regenerateArtifacts(root, { get: async () => null });
  expect(existsSync(join(root, ".geode/graph.json"))).toBe(true);
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("A Note");
  expect(graph.nodes.some((n) => n.title === "A Note")).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

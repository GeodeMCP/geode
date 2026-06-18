import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKnowledgeTree, parseStatus } from "../../src/dashboard/knowledge.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-kn-"));
  writeFileSync(join(root, "index.md"), "i");
  mkdirSync(join(root, "clients")); writeFileSync(join(root, "clients", "x.md"), "x");
  mkdirSync(join(root, "integrations", "moneybird"), { recursive: true });
  writeFileSync(join(root, "integrations", "moneybird", "manifest.json"), "{}");
  mkdirSync(join(root, "artifacts")); writeFileSync(join(root, "artifacts", "out.md"), "o");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("buildKnowledgeTree includes knowledge, excludes integrations/artifacts/.git", async () => {
  const tree = await buildKnowledgeTree(root);
  const names = tree.map((n) => n.name).sort();
  expect(names).toContain("index.md");
  expect(names).toContain("clients");
  expect(names).not.toContain("integrations");
  expect(names).not.toContain("artifacts");
  const clients = tree.find((n) => n.name === "clients")!;
  expect(clients.type).toBe("dir");
  expect(clients.children!.map((c) => c.path)).toEqual(["clients/x.md"]);
});

test("parseStatus splits modified vs created", () => {
  const out = parseStatus(" M index.md\n?? note.md\nA  clients/y.md");
  expect(out.modified).toContain("index.md");
  expect(out.created.sort()).toEqual(["clients/y.md", "note.md"]);
});

test("parseStatus handles a runGit-trimmed first modified line (leading space stripped)", () => {
  // runGit trims stdout, turning " M index.md" into "M index.md"
  const out = parseStatus("M index.md\n?? note.md");
  expect(out.modified).toEqual(["index.md"]);
  expect(out.created).toEqual(["note.md"]);
});

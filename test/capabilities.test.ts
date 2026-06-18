import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, deriveCapabilities } from "../src/capabilities.js";

test("parseFrontmatter reads YAML frontmatter fields", () => {
  const md = "---\ntype: recipe\ntitle: Bookkeeping\ndescription: Book invoices\ntags: [finance]\n---\nbody";
  const fm = parseFrontmatter(md);
  expect(fm.type).toBe("recipe");
  expect(fm.title).toBe("Bookkeeping");
  expect(fm.description).toBe("Book invoices");
});

test("parseFrontmatter returns empty object when no frontmatter", () => {
  expect(parseFrontmatter("# just a heading")).toEqual({});
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-cap-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("deriveCapabilities lists integrations (from manifests) and recipes (from OKF frontmatter)", async () => {
  mkdirSync(join(root, "integrations", "moneybird"), { recursive: true });
  writeFileSync(join(root, "integrations", "moneybird", "manifest.json"), JSON.stringify({ name: "moneybird", type: "connection", description: "Bookkeeping", requires: ["MONEYBIRD_API_KEY"], actions: { create_invoice: { method: "POST", url: "https://x" } } }));
  mkdirSync(join(root, "recipes"), { recursive: true });
  writeFileSync(join(root, "recipes", "bookkeeping.md"), "---\ntype: recipe\ntitle: Bookkeeping\ndescription: Book invoices from email\n---\nsteps");
  const caps = await deriveCapabilities(root);
  expect(caps.integrations.map((i) => i.name)).toContain("moneybird");
  expect(caps.integrations[0].actions).toContain("create_invoice");
  expect(caps.recipes.map((r) => r.title)).toContain("Bookkeeping");
  expect(caps.text).toContain("moneybird");
  expect(caps.text).toContain("Bookkeeping");
});

test("deriveCapabilities on an empty vault returns empty lists + a friendly note", async () => {
  const caps = await deriveCapabilities(root);
  expect(caps.integrations).toEqual([]);
  expect(caps.recipes).toEqual([]);
  expect(caps.text).toMatch(/nothing yet|no capabilities/i);
});

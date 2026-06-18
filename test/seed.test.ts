import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVault, ensureArtifactsIgnored } from "../src/seed.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-seed-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("creates the two scaffold files on a fresh vault", async () => {
  const created = await seedVault(root);
  expect(created.sort()).toEqual(["AGENTS.md", "index.md"]);
  expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  expect(existsSync(join(root, "index.md"))).toBe(true);
  expect(readFileSync(join(root, "AGENTS.md"), "utf8").startsWith("---")).toBe(true);
});

test("is idempotent and never overwrites an existing file", async () => {
  writeFileSync(join(root, "AGENTS.md"), "MY EDITED SCHEMA");
  const created = await seedVault(root);
  expect(created.sort()).toEqual(["index.md"]); // AGENTS.md left alone
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("MY EDITED SCHEMA");
  expect(await seedVault(root)).toEqual([]); // second run creates nothing
});

test("ensureArtifactsIgnored creates .gitignore with artifacts/ on a fresh vault", async () => {
  const changed = await ensureArtifactsIgnored(root);
  expect(changed).toBe(true);
  expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("artifacts/");
});

test("ensureArtifactsIgnored appends to an existing .gitignore without clobbering, and is idempotent", async () => {
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  expect(await ensureArtifactsIgnored(root)).toBe(true);
  const content = readFileSync(join(root, ".gitignore"), "utf8");
  expect(content).toContain("node_modules/");
  expect(content).toContain("artifacts/");
  expect(await ensureArtifactsIgnored(root)).toBe(false); // already present → no change
});

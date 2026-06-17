import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVault } from "../src/seed.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-seed-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("creates the three scaffold files on a fresh vault", async () => {
  const created = await seedVault(root);
  expect(created.sort()).toEqual(["AGENTS.md", "capabilities.md", "index.md"]);
  expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  expect(existsSync(join(root, "index.md"))).toBe(true);
  expect(existsSync(join(root, "capabilities.md"))).toBe(true);
});

test("is idempotent and never overwrites an existing file", async () => {
  writeFileSync(join(root, "AGENTS.md"), "MY EDITED SCHEMA");
  const created = await seedVault(root);
  expect(created.sort()).toEqual(["capabilities.md", "index.md"]); // AGENTS.md left alone
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("MY EDITED SCHEMA");
  expect(await seedVault(root)).toEqual([]); // second run creates nothing
});

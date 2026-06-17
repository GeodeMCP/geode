import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCapabilities } from "../src/capabilities.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-cap-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("returns capabilities.md contents when present", async () => {
  writeFileSync(join(root, "capabilities.md"), "# Capabilities\n\n- brand voice\n");
  const out = await listCapabilities(root);
  expect(out).toContain("brand voice");
});

test("returns a friendly fallback when capabilities.md is absent", async () => {
  const out = await listCapabilities(root);
  expect(out).toMatch(/no capabilities manifest yet/i);
});

import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOverlay, buildOverlay } from "../src/overlay.js";
import { kernelSkillsDir } from "../src/skills.js";

test("resolveOverlay falls back to the kernel default when no vault AGENTS.md", () => {
  const root = mkdtempSync(join(tmpdir(), "geode-ov-"));
  expect(resolveOverlay(root)).toBe(join(kernelSkillsDir(), "AGENTS.md"));
});
test("resolveOverlay returns the vault AGENTS.md when present (override wins)", () => {
  const root = mkdtempSync(join(tmpdir(), "geode-ov-"));
  writeFileSync(join(root, "AGENTS.md"), "# mine\n");
  expect(resolveOverlay(root)).toBe(join(root, "AGENTS.md"));
});
test("buildOverlay injects the labeled kernel default when no vault override", () => {
  const root = mkdtempSync(join(tmpdir(), "geode-ov-"));
  const o = buildOverlay(root);
  expect(o).toContain("Your vault's conventions (overlay)");
  expect(o).toContain("Canonical sources");
  expect(o).toContain("not a structural template"); // folder map groups by meaning, not a mirror template
});
test("buildOverlay uses the vault override, stripping its frontmatter", () => {
  const root = mkdtempSync(join(tmpdir(), "geode-ov-"));
  writeFileSync(join(root, "AGENTS.md"), "---\ntype: schema\n---\n\n# House rules\n- be terse\n");
  const o = buildOverlay(root);
  expect(o).toContain("House rules");
  expect(o).toContain("be terse");
  expect(o).not.toContain("type: schema");
});
test("buildOverlay returns '' for a frontmatter-only override", () => {
  const root = mkdtempSync(join(tmpdir(), "geode-ov-"));
  writeFileSync(join(root, "AGENTS.md"), "---\ntype: schema\n---\n");
  expect(buildOverlay(root)).toBe("");
});
test("buildOverlay strips CRLF frontmatter (Windows line endings)", () => {
  const root = mkdtempSync(join(tmpdir(), "geode-ov-"));
  writeFileSync(join(root, "AGENTS.md"), "---\r\ntype: schema\r\n---\r\n\r\n# House rules\r\n- be terse\r\n");
  const o = buildOverlay(root);
  expect(o).toContain("House rules");
  expect(o).not.toContain("type: schema");
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { kernelSkillsDir, resolveSkill, buildSkillsFooter } from "../src/skills.js";

test("kernelSkillsDir points at the shipped kernel-skills dir containing onboard-tool.md", () => {
  const dir = kernelSkillsDir();
  expect(dir.endsWith("kernel-skills")).toBe(true);
});

test("resolveSkill returns the kernel default when no vault override exists", () => {
  const root = mkdtempSync(join(tmpdir(), "ge-vault-"));
  expect(resolveSkill(root, "onboard-tool.md")).toBe(join(kernelSkillsDir(), "onboard-tool.md"));
});

test("resolveSkill returns the vault override when present (vault wins)", () => {
  const root = mkdtempSync(join(tmpdir(), "ge-vault-"));
  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(join(root, "skills", "onboard-tool.md"), "mine");
  expect(resolveSkill(root, "onboard-tool.md")).toBe(join(root, "skills", "onboard-tool.md"));
});

test("buildSkillsFooter names the resolved onboarding-skill path", () => {
  const root = mkdtempSync(join(tmpdir(), "ge-vault-"));
  const footer = buildSkillsFooter(root);
  expect(footer).toContain(resolveSkill(root, "onboard-tool.md"));
  expect(footer.toLowerCase()).toContain("onboard");
});

import { readFileSync } from "node:fs";
test("the shipped onboard-tool SOP exists and is substantive", () => {
  const body = readFileSync(join(kernelSkillsDir(), "onboard-tool.md"), "utf8");
  expect(body.length).toBeGreaterThan(400);
  expect(body).toContain("TOOL.md");
  expect(body.toLowerCase()).toContain("never install");
});

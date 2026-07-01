import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kernelSkillsDir } from "./skills.js";

/** Resolves the overlay file: the vault's own `AGENTS.md` if present, else the kernel default. */
export function resolveOverlay(vaultRoot: string): string {
  const override = join(vaultRoot, "AGENTS.md");
  return existsSync(override) ? override : join(kernelSkillsDir(), "AGENTS.md");
}

/** Reads the resolved overlay, strips any OKF frontmatter, and returns it as a labelled, core-subordinate prompt section (or "" when empty/missing). */
export function buildOverlay(vaultRoot: string): string {
  let body = "";
  try { body = readFileSync(resolveOverlay(vaultRoot), "utf8"); } catch { return ""; }
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").trim();
  if (!body) return "";
  return `\n\n## Your vault's conventions (overlay)\nThe owner may customize these in \`AGENTS.md\`; honor them. They REFINE the rules above and never override them (e.g. they can never grant running tools or writing secrets).\n\n${body}`;
}

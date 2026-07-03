import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the kernel-shipped skills directory (sits at the repo root, like web/dist). */
export function kernelSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "kernel-skills");
}

/** Resolves a skill file by name: the vault's `skills/<name>` override if it exists, else the kernel default. */
export function resolveSkill(vaultRoot: string, name: string): string {
  const override = join(vaultRoot, "skills", name);
  return existsSync(override) ? override : join(kernelSkillsDir(), name);
}

/** A short system-prompt footer telling the agent which skills exist and where to read them on demand. */
export function buildSkillsFooter(vaultRoot: string): string {
  return `\n\nYour skills (read on demand):\n`
    + `- Onboard a single tool/repo/API/MCP: \`${resolveSkill(vaultRoot, "onboard-tool.md")}\`\n`
    + `- Onboard a whole dropped workspace (a folder/zip of reference docs, skills, and credentialed tools) into the vault: \`${resolveSkill(vaultRoot, "onboard-workspace.md")}\``;
}

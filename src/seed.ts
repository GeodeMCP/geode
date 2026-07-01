import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Map of filename to default content for the files written into a new vault during seeding. */
export const SCAFFOLD: Record<string, string> = {
  "index.md": `---
type: index
title: Index
description: Catalog of concepts, kept current by the agent
---

# Index

Each entry: a link + a one-line summary.
`,
};

/** Ensures the vault's .gitignore excludes the artifacts/ dir. Returns true if it changed the file. */
export async function ensureArtifactsIgnored(root: string): Promise<boolean> {
  const path = join(root, ".gitignore");
  const current = existsSync(path) ? await readFile(path, "utf8") : "";
  if (current.split("\n").map((l) => l.trim()).includes("artifacts/")) return false;
  const next = current.length === 0
    ? "artifacts/\n"
    : current.endsWith("\n") ? `${current}artifacts/\n` : `${current}\nartifacts/\n`;
  await writeFile(path, next);
  return true;
}

/** Writes any scaffold file that does not already exist. Returns the names created. */
export async function seedVault(root: string): Promise<string[]> {
  const created: string[] = [];
  for (const [name, content] of Object.entries(SCAFFOLD)) {
    if (!existsSync(join(root, name))) {
      await writeFile(join(root, name), content);
      created.push(name);
    }
  }
  return created;
}

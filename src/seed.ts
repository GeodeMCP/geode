import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SCAFFOLD: Record<string, string> = {
  "AGENTS.md": `# Vault schema

This file is the schema for this Geode vault. You and the agent co-evolve it.

## Folder map
- (add top-level folders and what they hold)

## Conventions
- Canonical sources: every fact lives in exactly one file; other files reference it by path, never copy it.
- Inheritance: rules/conventions defined higher in the tree apply to everything below — don't restate them.
- Naming: kebab-case file names; one clear topic per file.
`,
  "index.md": `# Index

Catalog of pages, kept current by the agent: each entry is a link + a one-line summary.
`,
  "capabilities.md": `# Capabilities

Kept current by the agent — what this vault offers.

## Recipes & skills
## Integrations
`,
};

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

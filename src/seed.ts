import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SCAFFOLD: Record<string, string> = {
  "AGENTS.md": `---
type: schema
title: Vault schema
description: Conventions for this Geode vault (you and the agent co-evolve this)
---

# Vault schema

## Folder map
- (add top-level folders and what they hold)

## Conventions
- Canonical sources: every fact lives in exactly one file; other files reference it by path, never copy it.
- Inheritance: rules/conventions defined higher in the tree apply to everything below — don't restate them.
- Concepts are OKF files: YAML frontmatter with at least \`type\` (+ \`title\`/\`description\`/\`tags\`).
- Naming: kebab-case file names; one clear topic per file.
`,
  "index.md": `---
type: index
title: Index
description: Catalog of concepts, kept current by the agent
---

# Index

Each entry: a link + a one-line summary.
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

# Vault schema

## Folder map
- (top-level folders and what they hold)

## Conventions
- Canonical sources: every fact lives in exactly one file; other files reference it by path, never copy it.
- Inheritance: rules/conventions defined higher in the tree apply to everything below — don't restate them.
- Concepts are OKF files: YAML frontmatter with at least `type` (+ `title`/`description`/`tags`).
- Naming: kebab-case file names; one clear topic per file.

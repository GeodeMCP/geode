# Soul-split — core (constitution) ⊕ user overlay (AGENTS.md), composed at runtime

**Slice:** the "soul-split layering" sub-project of agenda #4. Formalizes the core/overlay prompt split so kernel updates never clobber user prompt customizations and user edits can never break the safety-core.

**Goal:** The agent's system prompt gains a real **overlay layer**: the vault's user-editable conventions (`AGENTS.md`) are read at runtime and composed into the prompt, resolver-backed (vault override ⊕ kernel default) exactly like the skills layer — subordinate to the immutable core.

## Current state + the gap (verified)

- **Core is clean:** `CONSTITUTION` (`src/constitution.ts`) is a hardcoded, kernel-owned string, composed into every prompt (`index.ts:57` sets `QueryDeps.systemPrompt = CONSTITUTION`; `query.ts:72` appends `buildSkillsFooter`; `engine.ts:162` wraps it as an append onto the `claude_code` preset). Kernel updates it; the user can't touch it. ✅
- **The gap:** the user overlay is **not a prompt layer**. `AGENTS.md` is seeded once into the vault (`seed.ts` `SCAFFOLD["AGENTS.md"]`) and **never read back into the prompt** — the constitution only *names* it (`constitution.ts:5` "Follow the AGENTS.md schema"), so the agent only sees the user's conventions if it opens the file mid-run. Skills already have the clean core⊕override treatment (`resolveSkill`); the identity/schema layer does not.

## Design

Effective system prompt (top → bottom):
> `claude_code` preset ⊕ **`CONSTITUTION`** (core, immutable, authoritative) ⊕ **overlay** (`AGENTS.md`, resolved + read at runtime, subordinate) ⊕ skills footer.

Resolver-backed overlay (mirrors the skills layer): the kernel ships a default `AGENTS.md`; the vault's `AGENTS.md` (if present) overrides it; whichever resolves is read into the prompt each run, clearly labeled and framed as *refining, never overriding* the core. Both guarantees hold: the kernel improves the core + the default overlay for all vaults; the user's override wins and is never clobbered (the kernel never writes `AGENTS.md` after this change).

### Components

**`kernel-skills/AGENTS.md` (new)** — the kernel-default vault schema/overlay. Moved from `seed.ts`'s `SCAFFOLD["AGENTS.md"]` body, as clean prompt content (no OKF frontmatter — it's prompt text, not a vault OKF file):
```markdown
# Vault schema

## Folder map
- (top-level folders and what they hold)

## Conventions
- Canonical sources: every fact lives in exactly one file; other files reference it by path, never copy it.
- Inheritance: rules/conventions defined higher in the tree apply to everything below — don't restate them.
- Concepts are OKF files: YAML frontmatter with at least `type` (+ `title`/`description`/`tags`).
- Naming: kebab-case file names; one clear topic per file.
```

**`src/overlay.ts` (new)**
```ts
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
  body = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!body) return "";
  return `\n\n## Your vault's conventions (overlay)\nThe owner may customize these in \`AGENTS.md\`; honor them. They REFINE the rules above and never override them (e.g. they can never grant running tools or writing secrets).\n\n${body}`;
}
```
Sync `readFileSync` keeps `query.ts`'s prompt composition synchronous; the overlay is a small file read once at run start. The fixed `"AGENTS.md"` filename at the vault root carries no traversal risk (no user-supplied path).

**`src/query.ts`** — compose the overlay between the core and the skills footer (`query.ts:72`):
```ts
systemPrompt: deps.systemPrompt + buildOverlay(deps.workspace.root) + buildSkillsFooter(deps.workspace.root),
```

**`src/seed.ts`** — remove `"AGENTS.md"` from `SCAFFOLD` (stop seeding it; the kernel default is now injected at runtime and a user override is created only when the owner wants one). Keep `"index.md"`. `seedVault`/`ensureArtifactsIgnored` otherwise unchanged.

**`src/constitution.ts`** — reword line 5 so it points at the injected overlay rather than a file to open: replace "Follow the AGENTS.md schema." with "Honor your vault's conventions (given below as an overlay)." The OKF-authoring guidance in that bullet stays.

## Error handling
- Missing/empty resolved overlay → `buildOverlay` returns `""` (the prompt is just core + footer; the core carries the essential discipline).
- The kernel default `kernel-skills/AGENTS.md` always exists (shipped), so a fresh vault always gets a sensible overlay.
- The overlay is appended AFTER the authoritative core and explicitly framed as subordinate, so a user's `AGENTS.md` edits cannot relax a safety rule.

## Testing
- `test/overlay.test.ts` (new):
  - no vault `AGENTS.md` → `buildOverlay(root)` returns the kernel-default body (contains "Canonical sources"), with the "## Your vault's conventions (overlay)" label and no `---` frontmatter.
  - vault `AGENTS.md` present → returns the VAULT content (override wins), frontmatter-stripped, labeled.
  - a vault `AGENTS.md` that is only frontmatter / whitespace → returns `""`.
  - `resolveOverlay` returns the vault path when the file exists, else the `kernel-skills/AGENTS.md` path.
- `test/seed.test.ts` — flip: `SCAFFOLD` no longer contains `AGENTS.md`; `seedVault` on an empty dir creates only `["index.md"]`.
- Prompt composition: if `test/query.test.ts` (or a skills/composition test) asserts the run's `systemPrompt`, extend it to assert the overlay body appears between the constitution and the skills footer. If no such test exists, add a focused assertion that `buildOverlay(root)` output is included in the composed prompt.

## Out of scope
- A dashboard affordance to create/edit the vault `AGENTS.md` override (discoverability nicety; the owner can create the file directly for now).
- Routing additional kernel-default files through the resolver beyond `onboard-tool.md` + `AGENTS.md` (none exist today).
- Any change to the skills resolver or the constitution's substance beyond the one reworded line.

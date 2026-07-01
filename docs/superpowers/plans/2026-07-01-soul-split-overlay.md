# Soul-split overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a runtime **overlay layer** to the agent's system prompt: the vault's `AGENTS.md` (resolver-backed: vault override ⊕ kernel default), composed between the immutable core and the skills footer.

**Architecture:** New `src/overlay.ts` (`resolveOverlay` + `buildOverlay`, mirroring `skills.ts`) + a kernel-default `kernel-skills/AGENTS.md`; composed in `query.ts`; `AGENTS.md` dropped from the vault seed; one constitution line reworded.

**Tech Stack:** TypeScript ESM, vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-soul-split-overlay-design.md`

**Conventions:** terse style; husky gate = eslint + JSDoc-on-exports + `tsc`. Exports need `/** … */`. Server tests from repo root: `npx vitest run`.

---

### Task 1: `overlay.ts` + kernel default + tests

**Files:** Create `src/overlay.ts`, `kernel-skills/AGENTS.md`, `test/overlay.test.ts`.

- [ ] **Step 1: Create `kernel-skills/AGENTS.md`** (kernel-default overlay, no frontmatter — it's prompt content):
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

- [ ] **Step 2: Write `test/overlay.test.ts` (TDD)** — mirror `test/skills.test.ts`'s pattern:
```ts
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
```

- [ ] **Step 3: Run — fail.** `npx vitest run test/overlay.test.ts` → FAIL (module missing).

- [ ] **Step 4: Create `src/overlay.ts`** (verbatim from the spec):
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

- [ ] **Step 5: Run — pass.** `npx vitest run test/overlay.test.ts` → green.

- [ ] **Step 6: Commit**
```bash
git add src/overlay.ts kernel-skills/AGENTS.md test/overlay.test.ts
git commit -m "feat(soul-split): overlay resolver (vault AGENTS.md ⊕ kernel default)"
```

---

### Task 2: Compose the overlay + stop seeding AGENTS.md + reword constitution

**Files:** Modify `src/query.ts`, `src/seed.ts`, `src/constitution.ts`, `test/seed.test.ts`; check/extend `test/query.test.ts` + `test/constitution.test.ts`.

- [ ] **Step 1: Flip the seed test (TDD)**
Read `test/seed.test.ts`. It asserts `SCAFFOLD`/`seedVault` behavior including `AGENTS.md`. Update the assertions so `SCAFFOLD` no longer contains `AGENTS.md` and `seedVault` on an empty dir returns only `["index.md"]` (and any "AGENTS.md created" assertion is removed). Watch it fail against the current seed.

- [ ] **Step 2: Read + adjust the prompt-composition test**
Read `test/query.test.ts` and `test/constitution.test.ts`. If either asserts the composed run `systemPrompt` (e.g. that it contains `buildSkillsFooter` output or the constitution text), extend it to also assert the overlay label `"Your vault's conventions (overlay)"` appears. If `constitution.test.ts` asserts the literal string "Follow the AGENTS.md schema", update it to the reworded line (Step 5). Add these assertions now so they fail pre-implementation where applicable.

- [ ] **Step 3: Compose the overlay in `src/query.ts`**
At the `systemPrompt:` line (~72), import `buildOverlay` from `./overlay.js` and insert it between the core and the footer:
```ts
systemPrompt: deps.systemPrompt + buildOverlay(deps.workspace.root) + buildSkillsFooter(deps.workspace.root),
```

- [ ] **Step 4: Drop `AGENTS.md` from the seed in `src/seed.ts`**
Remove the `"AGENTS.md": \`…\`` entry from `SCAFFOLD` (keep `"index.md"`). `seedVault`/`ensureArtifactsIgnored` unchanged.

- [ ] **Step 5: Reword `src/constitution.ts` line 5**
Change `Treat the directory as a maintained vault. Follow the AGENTS.md schema. Author concepts as OKF files: …` → `Treat the directory as a maintained vault. Honor your vault's conventions (given below as an overlay). Author concepts as OKF files: …` (keep the rest of the bullet verbatim).

- [ ] **Step 6: Run — pass.** `npx vitest run test/seed.test.ts test/query.test.ts test/constitution.test.ts test/overlay.test.ts` → green.

- [ ] **Step 7: Full suite + gate.** `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint src test` clean (0 errors).

- [ ] **Step 8: Commit**
```bash
git add src/query.ts src/seed.ts src/constitution.ts test/seed.test.ts test/query.test.ts test/constitution.test.ts
git commit -m "feat(soul-split): compose the AGENTS.md overlay at runtime; drop it from the seed"
```

---

## Final verification
- `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint src test` clean.
- A fresh vault seeds only `index.md`; the agent's prompt = constitution (core) ⊕ the kernel-default `AGENTS.md` overlay (labeled, subordinate) ⊕ skills footer; a vault `AGENTS.md` overrides the kernel default and is never seeded/clobbered.

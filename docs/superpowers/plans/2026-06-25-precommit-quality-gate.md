# Pre-commit Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatic per-commit gate that enforces TypeScript-ESLint conventions, JSDoc on the exported API, and `tsc` type-checks on staged files — plus a one-time pass that brings the entire existing codebase into compliance.

**Architecture:** A single ESLint flat config at the repo root lints both packages (root `geode-kernel` and `web` `geode-web`), with a `web/src/**` override for React/TSX. Husky + lint-staged run from the root and check only staged files; `tsc` runs per package so each uses its own TypeScript version. Phase 0 builds the tooling; Phase 1 is a one-time whole-repo cleanup (~130+ JSDoc blocks); Phase 2 is the steady state (staged-only).

**Tech Stack:** ESLint 9 (flat config), typescript-eslint, eslint-plugin-jsdoc, eslint-plugin-react + react-hooks, husky 9, lint-staged.

**Spec:** `docs/superpowers/specs/2026-06-25-precommit-quality-gate-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `eslint.config.js` (create, root) | Flat config: TS baseline + JSDoc rules; `web/src/**` React/TSX override; ignores. Lints both packages. |
| `lint-staged.config.js` (create, root) | Maps staged globs → `eslint --fix` (+ per-package `typecheck`). |
| `.husky/pre-commit` (create) | Runs `npx lint-staged` on commit. |
| `package.json` (modify, root) | Add devDeps; add `"lint"`, `"typecheck"`, `"prepare"` scripts. |
| `web/package.json` (modify) | Add `"typecheck"` script (uses web's own TS 5.6). |

**Phase 1 touches** every file under `src/` and `web/src/` that exports symbols without JSDoc — content changes only (doc blocks + auto-fixable lint), no logic changes.

---

## Phase 0 — Tooling Setup

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (root, `devDependencies`)

- [ ] **Step 1: Install dev dependencies at root**

Run:
```bash
npm install -D eslint typescript-eslint eslint-plugin-jsdoc eslint-plugin-react eslint-plugin-react-hooks globals husky lint-staged
```
Expected: installs without error; `node_modules/.bin/eslint` and `node_modules/.bin/husky` now exist.

- [ ] **Step 2: Verify binaries are present**

Run:
```bash
ls node_modules/.bin/eslint node_modules/.bin/husky node_modules/.bin/lint-staged
```
Expected: all three paths print (no "No such file").

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add eslint/jsdoc/husky/lint-staged dev deps"
```

---

### Task 2: Create the ESLint flat config

**Files:**
- Create: `eslint.config.js` (root)

- [ ] **Step 1: Write `eslint.config.js`**

```js
// eslint.config.js
import tseslint from 'typescript-eslint'
import jsdoc from 'eslint-plugin-jsdoc'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'web/dist/',
      '**/node_modules/',
      '.worktrees/',
      '**/*.tsbuildinfo',
    ],
  },

  // Baseline conventions for all TypeScript (non-type-checked = fast).
  ...tseslint.configs.recommended,

  // Doc-block enforcement: JSDoc required on the exported (public) API.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          ClassDeclaration: true,
          MethodDefinition: true,
        },
        contexts: [
          'TSInterfaceDeclaration',
          'TSTypeAliasDeclaration',
          'TSEnumDeclaration',
          'ExportNamedDeclaration > VariableDeclaration',
        ],
      }],
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-alignment': 'error',
    },
  },

  // Root (Node) source + tests get Node globals.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Web override: React/TSX in the browser.
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
    },
  },
)
```

- [ ] **Step 2: Verify the config loads (no rule/plugin shape errors)**

Run:
```bash
npx eslint --print-config src/index.ts > /dev/null && echo "CONFIG OK"
```
Expected: prints `CONFIG OK`. If ESLint errors on config load (e.g. `react.configs.flat` undefined or `reactHooks.configs.recommended` shape mismatch for the installed plugin version), adjust the offending line to match the installed plugin's flat-config API, then re-run until `CONFIG OK`.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "build: add root eslint flat config (ts baseline + jsdoc + web react override)"
```

---

### Task 3: Add lint and type-check scripts

**Files:**
- Modify: `package.json` (root, `scripts`)
- Modify: `web/package.json` (`scripts`)

- [ ] **Step 1: Add scripts to root `package.json`**

Add to the `"scripts"` object:
```json
"lint": "eslint .",
"typecheck": "tsc --noEmit"
```

- [ ] **Step 2: Add a typecheck script to `web/package.json`**

Add to the `"scripts"` object:
```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 3: Verify both type-checks run (errors expected for now, command must execute)**

Run:
```bash
npm run typecheck; npm --prefix web run typecheck
```
Expected: both commands execute (they invoke each package's own `tsc`). Type *errors* may print — that is fine at this stage; we only confirm the scripts are wired and use the right TypeScript. Root must use TS 6, web TS 5.6.

- [ ] **Step 4: Commit**

```bash
git add package.json web/package.json
git commit -m "build: add lint + per-package typecheck scripts"
```

---

### Task 4: Add the lint-staged config

**Files:**
- Create: `lint-staged.config.js` (root)

- [ ] **Step 1: Write `lint-staged.config.js`**

```js
// lint-staged.config.js
// Runs only on staged files. `eslint --fix` repairs + re-stages trivial issues;
// unfixable problems (missing JSDoc, real errors, type errors) block the commit.
// The typecheck entries are functions so they ignore the passed filenames and
// run project-wide for the package that has staged changes.
export default {
  'src/**/*.ts': ['eslint --fix', () => 'npm run typecheck'],
  'test/**/*.ts': ['eslint --fix'],
  'web/src/**/*.{ts,tsx}': ['eslint --fix', () => 'npm --prefix web run typecheck'],
}
```

- [ ] **Step 2: Commit**

```bash
git add lint-staged.config.js
git commit -m "build: add lint-staged config (eslint --fix + per-package typecheck)"
```

---

### Task 5: Install the Husky pre-commit hook

**Files:**
- Create: `.husky/pre-commit`
- Modify: `package.json` (root — `prepare` script, added by husky init)

- [ ] **Step 1: Initialize husky**

Run:
```bash
npx husky init
```
Expected: creates `.husky/` and adds `"prepare": "husky"` to `package.json`. It writes a default `.husky/pre-commit` (containing `npm test`).

- [ ] **Step 2: Replace the hook body with lint-staged**

Overwrite `.husky/pre-commit` so its entire contents are exactly:
```sh
npx lint-staged
```

- [ ] **Step 3: Verify `prepare` script exists**

Run:
```bash
node -e "console.log(require('./package.json').scripts.prepare)"
```
Expected: prints `husky`.

- [ ] **Step 4: Commit**

```bash
git add .husky/pre-commit package.json
git commit -m "build: install husky pre-commit hook running lint-staged"
```

---

### Task 6: Prove the gate blocks a bad commit (and passes a good one)

**Files:**
- Temporary: `src/__gate_probe__.ts` (created then deleted)

- [ ] **Step 1: Create a file that violates the JSDoc rule**

Create `src/__gate_probe__.ts`:
```ts
export function gateProbe(value: number): number {
  return value + 1
}
```
(Exported function with no JSDoc → must trip `jsdoc/require-jsdoc`.)

- [ ] **Step 2: Stage it and attempt to commit — expect the hook to BLOCK**

Run:
```bash
git add src/__gate_probe__.ts
git commit -m "test: gate probe (should fail)"
```
Expected: commit **fails**; lint-staged output reports `jsdoc/require-jsdoc` (Missing JSDoc comment) for `src/__gate_probe__.ts`. No commit is created.

- [ ] **Step 3: Add a valid JSDoc and confirm the commit now passes**

Edit `src/__gate_probe__.ts` to:
```ts
/** Adds one to the given value. */
export function gateProbe(value: number): number {
  return value + 1
}
```
Run:
```bash
git add src/__gate_probe__.ts
git commit -m "test: gate probe (should pass)"
```
Expected: commit **succeeds**.

- [ ] **Step 4: Remove the probe file and commit the removal**

Run:
```bash
git rm src/__gate_probe__.ts
git commit -m "test: remove gate probe"
```
Expected: succeeds. Phase 0 is verified — the gate blocks missing JSDoc and allows valid changes.

---

## Phase 1 — One-Time Whole-Repo Cleanup

Goal: `npx eslint .` reports zero errors and both packages type-check cleanly. No logic changes — only auto-fixable lint and authored JSDoc.

### Task 7: Auto-fix sweep + capture the remaining work

**Files:**
- Modify: many under `src/`, `test/`, `web/src/` (auto-fix only)

- [ ] **Step 1: Run ESLint auto-fix across the whole repo**

Run:
```bash
npx eslint . --fix
```
Expected: command completes; trivial convention/format issues are fixed in place. Remaining (unfixable) errors print — predominantly `jsdoc/require-jsdoc` "Missing JSDoc comment".

- [ ] **Step 2: Capture the remaining errors grouped by file**

Run:
```bash
npx eslint . -f compact 2>&1 | tee /tmp/eslint-cleanup.txt
echo "--- files with remaining errors ---"
grep -oE '^[^:]+' /tmp/eslint-cleanup.txt | sort -u
```
Expected: a list of files still failing. This list drives Tasks 8–9.

- [ ] **Step 3: Commit the auto-fixes**

```bash
git add -A
git commit -m "chore: eslint --fix auto-fixable convention/format issues"
```
(If `eslint --fix` changed nothing, skip this commit.)

---

### Task 8: Author JSDoc for `src/` (parallelizable)

**Files:**
- Modify: every `src/**/*.ts` flagged in `/tmp/eslint-cleanup.txt` (~110 exports, ~7 already documented)

**Batching for parallel subagents** — dispatch one subagent per group:
- Group A: `src/account.ts`, `src/artifacts.ts`, `src/capabilities.ts`, `src/config.ts`, `src/constitution.ts`, `src/engine.ts`
- Group B: `src/eventLog.ts`, `src/git.ts`, `src/index.ts`, `src/ingest.ts`, `src/integrations.ts`, `src/invoke.ts`
- Group C: `src/query.ts`, `src/runManager.ts`, `src/secrets.ts`, `src/seed.ts`, `src/server.ts`, `src/smoke.ts`
- Group D: `src/toolCatalog.ts`, `src/transcripts.ts`, `src/workspace.ts`, `src/ownerCli.ts`, `src/secretCli.ts`
- Group E: everything under `src/dashboard/`
- Group F: everything under `src/oauth/`

- [ ] **Step 1: For each group, author meaningful JSDoc on flagged exports**

Per file, for every export flagged with `jsdoc/require-jsdoc`, read the symbol's implementation and add a JSDoc block **immediately above it** with a one-line summary that accurately states what it does. Rules:
- Describe behavior truthfully based on the actual code — do not guess.
- Do **not** add `@param`/`@returns` text (the rule does not require it; TS types cover them).
- Do **not** change any logic, signatures, or formatting beyond inserting the comment.
- English only (project convention).

Example shape:
```ts
/** Loads the owner account from the secrets store, or null if none exists. */
export function getOwnerAccount(): Account | null {
  // ...unchanged...
}
```

- [ ] **Step 2: Verify `src/` is clean**

Run:
```bash
npx eslint src test
```
Expected: zero errors. Fix any stragglers (e.g. a `contexts` node type that still needs a block) until clean.

- [ ] **Step 3: Commit**

```bash
git add src test
git commit -m "docs: add JSDoc to exported API across src/"
```

---

### Task 9: Author JSDoc for `web/src/` (parallelizable)

**Files:**
- Modify: every `web/src/**/*.{ts,tsx}` flagged in `/tmp/eslint-cleanup.txt` (~34 exports, ~3 already documented)

**Batching for parallel subagents:**
- Group A: `web/src/api.ts`, `web/src/markdown.ts`, `web/src/timeline.ts`, `web/src/App.tsx`, `web/src/main.tsx`
- Group B: everything under `web/src/components/`
- Group C: everything under `web/src/views/`

(`*.test.ts` files export nothing public — they should not be flagged. Leave them unless ESLint flags them.)

- [ ] **Step 1: For each group, author meaningful JSDoc on flagged exports**

Same rules as Task 8, Step 1. For React components, the one-line summary describes what the component renders / is responsible for, e.g.:
```ts
/** Renders the run timeline with collapsible transcript entries. */
export function Timeline(props: TimelineProps) {
  // ...unchanged...
}
```

- [ ] **Step 2: Verify `web/src/` is clean**

Run:
```bash
npx eslint web/src
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add web/src
git commit -m "docs: add JSDoc to exported API across web/src/"
```

---

### Task 10: Make both packages type-check cleanly

**Files:**
- Modify: only files with genuine type errors surfaced by `tsc` (if any)

- [ ] **Step 1: Type-check the root package**

Run:
```bash
npm run typecheck
```
Expected: zero errors. If errors appear, fix the offending types minimally (do not refactor unrelated code). Re-run until clean.

- [ ] **Step 2: Type-check the web package**

Run:
```bash
npm --prefix web run typecheck
```
Expected: zero errors. Fix minimally and re-run until clean.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type-check errors surfaced by the gate"
```
(Skip if there were no errors.)

---

### Task 11: Final whole-repo verification

- [ ] **Step 1: ESLint must be clean across the whole repo**

Run:
```bash
npx eslint .
```
Expected: exits 0, no output.

- [ ] **Step 2: Both type-checks must pass**

Run:
```bash
npm run typecheck && npm --prefix web run typecheck && echo "TYPECHECK OK"
```
Expected: prints `TYPECHECK OK`.

- [ ] **Step 3: Tests still pass (no logic changed, sanity check)**

Run:
```bash
npm test && npm --prefix web test
```
Expected: both suites pass. If a doc insertion accidentally altered behavior, fix it.

- [ ] **Step 4: Confirm the steady-state gate is intact**

Run:
```bash
cat .husky/pre-commit
```
Expected: prints exactly `npx lint-staged`. From here the gate checks only staged files (Phase 2 — no further action needed).

---

## Self-Review Notes

- **Spec coverage:** baseline conventions (Task 2 tseslint.recommended) ✓; JSDoc-on-exports (Task 2 rules + Tasks 8–9) ✓; staged-only gate (Tasks 4–5) ✓; auto-fix & re-stage (Task 4) ✓; per-package tsc (Tasks 3, 10) ✓; one-time meaningful-JSDoc cleanup (Tasks 7–11) ✓; husky activation via `prepare` (Task 5) ✓; ignores incl. `.worktrees` (Task 2) ✓.
- **TS 6 caveat:** Task 2 Step 2 catches typescript-eslint config-load failures; if TS 6 triggers only a runtime "unsupported version" warning, it is non-blocking and acceptable.
- **Scope:** root typecheck covers `src` only (matches `tsconfig.json` include + the build); `test/` is linted but not type-checked, per spec.

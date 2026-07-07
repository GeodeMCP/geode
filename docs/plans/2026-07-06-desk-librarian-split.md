# Desk/Librarian Agent Split + Terser Desk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the desk (`query`) and the librarian (`remember`/ingest) their own system-prompt fragments over a shared core, so a desk-only terseness instruction no longer pollutes the librarian.

**Architecture:** Today both roles run through `query()` with one shared prompt (`deps.systemPrompt` = the constitution). This plan keeps the constitution as the **shared core** and adds two role fragments (`DESK_FRAGMENT`, `LIBRARIAN_FRAGMENT`). `query()` composes `core + fragmentFor(role) + overlay + skills`, defaulting to `desk`; `remember`/ingest passes `role: "librarian"`. The desk fragment carries the new terseness rule; the librarian fragment starts empty (the mechanism is the point — later phases move more behaviour into it).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, tsx.

**Source of truth:** `docs/design/2026-07-06-capability-foundation.md` → section *"Desk and librarian are separate agents (no cross-pollution)"*. This plan implements the first, buildable slice of that decision (the prompt-composition split). The broader foundation (write-time graph index, list_capabilities serialization, retrieval/scoping, backlog counting) has open design questions and is deliberately **out of scope** here — plan those per phase later.

## Global Constraints

- All in-app/UI/code strings in **English** (chat stays Dutch; never Dutch in the codebase).
- New exported symbols need JSDoc or the husky pre-commit gate blocks the commit.
- ESM: import paths use `.js` extensions even for `.ts` files.
- Run tests with `npx vitest run <path>`; typecheck with `npx tsc --noEmit`.
- Do not touch `.env` (gitignored). Work on branch `plan/capability-foundation`'s follow-up execution branch, not `main`.

## File Structure

- `src/constitution.ts` (modify) — keep `CONSTITUTION` as the shared core; add `DESK_FRAGMENT`, `LIBRARIAN_FRAGMENT`, `AgentRole`, and `fragmentFor(role)`.
- `src/query.ts` (modify) — add exported `composeSystemPrompt(deps, role)`; add `role` to `query()`'s `opts`; use the composer at line 82.
- `src/ingest.ts` (modify) — `remember()` forwards `role: "librarian"` to `query()`.
- `test/constitution.test.ts` (create) — unit tests for `fragmentFor`.
- `test/query-prompt.test.ts` (create) — unit tests for `composeSystemPrompt`.

---

### Task 1: Role fragments + `fragmentFor` in the constitution

**Files:**
- Modify: `src/constitution.ts`
- Test: `test/constitution.test.ts` (create)

**Interfaces:**
- Produces: `type AgentRole = "desk" | "librarian"`; `DESK_FRAGMENT: string`; `LIBRARIAN_FRAGMENT: string`; `fragmentFor(role: AgentRole): string`. `CONSTITUTION` (existing export) is unchanged and is the shared core.

- [ ] **Step 1: Write the failing test**

Create `test/constitution.test.ts`:

```typescript
import { test, expect } from "vitest";
import { fragmentFor, CONSTITUTION } from "../src/constitution.js";

test("desk fragment adds terseness; librarian fragment does not", () => {
  const desk = fragmentFor("desk");
  const librarian = fragmentFor("librarian");
  expect(desk.toLowerCase()).toContain("minimal");
  expect(desk.toLowerCase()).toContain("no section headers");
  expect(librarian.toLowerCase()).not.toContain("no section headers");
});

test("the core (constitution) carries neither role's terseness rule", () => {
  expect(CONSTITUTION.toLowerCase()).not.toContain("no section headers");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/constitution.test.ts`
Expected: FAIL — `fragmentFor` is not exported.

- [ ] **Step 3: Implement the fragments + `fragmentFor`**

In `src/constitution.ts`, after the existing `CONSTITUTION` export, add:

```typescript
/** Which agent a run is: the desk answers/plans; the librarian files/maintains. */
export type AgentRole = "desk" | "librarian";

/** Desk-only prompt fragment: terse answers/plans. Never loaded for the librarian. */
export const DESK_FRAGMENT = `

Desk output — keep it minimal:
- Return the exact invoke(tool, action, params, connection) calls (or a direct answer), plus at most one short caveat line when an assumption actually matters.
- No section headers, no strategy write-ups, no restating the request.`;

/** Librarian-only prompt fragment. Empty for now — later phases move filing/onboarding behaviour here. */
export const LIBRARIAN_FRAGMENT = "";

/** Returns the role-specific prompt fragment appended to the shared core. */
export function fragmentFor(role: AgentRole): string {
  return role === "desk" ? DESK_FRAGMENT : LIBRARIAN_FRAGMENT;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/constitution.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/constitution.ts test/constitution.test.ts
git commit -m "feat(agent): add desk/librarian prompt fragments over the shared core"
```

---

### Task 2: Compose the per-role prompt in `query()`

**Files:**
- Modify: `src/query.ts`
- Test: `test/query-prompt.test.ts` (create)

**Interfaces:**
- Consumes: `fragmentFor`, `AgentRole` from Task 1; existing `buildOverlay(vaultRoot)` (`src/overlay.ts`) and `buildSkillsFooter(vaultRoot)` (`src/skills.ts`).
- Produces: `composeSystemPrompt(deps: Pick<QueryDeps, "systemPrompt" | "workspace">, role: AgentRole): string`; `query()`'s `opts` gains `role?: AgentRole` (default `"desk"`).

- [ ] **Step 1: Write the failing test**

Create `test/query-prompt.test.ts`:

```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { composeSystemPrompt } from "../src/query.js";

const deps = (): any => ({
  systemPrompt: "CORE-RULES",
  workspace: { root: mkdtempSync(join(tmpdir(), "geode-prompt-")) },
});

test("desk prompt = core + desk terseness; librarian prompt omits it", () => {
  const d = deps();
  const desk = composeSystemPrompt(d, "desk");
  const librarian = composeSystemPrompt(d, "librarian");
  expect(desk).toContain("CORE-RULES");
  expect(desk.toLowerCase()).toContain("no section headers");
  expect(librarian).toContain("CORE-RULES");
  expect(librarian.toLowerCase()).not.toContain("no section headers");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/query-prompt.test.ts`
Expected: FAIL — `composeSystemPrompt` is not exported.

- [ ] **Step 3: Implement the composer and use it**

In `src/query.ts`, update the import from constitution/overlay and add the composer. The file already imports `buildOverlay`; add `fragmentFor`/`AgentRole` and `buildSkillsFooter` if not already imported (check the top of the file):

```typescript
import { buildOverlay } from "./overlay.js";
import { buildSkillsFooter } from "./skills.js";
import { fragmentFor, type AgentRole } from "./constitution.js";
```

Add the exported composer (near the top-level helpers, e.g. beside `truncate`):

```typescript
/** Assembles the full system prompt for a run: shared core + role fragment + vault overlay + skills footer. */
export function composeSystemPrompt(
  deps: Pick<QueryDeps, "systemPrompt" | "workspace">,
  role: AgentRole,
): string {
  return deps.systemPrompt + fragmentFor(role) + buildOverlay(deps.workspace.root) + buildSkillsFooter(deps.workspace.root);
}
```

Extend `query()`'s `opts` type (line 58) to include the role:

```typescript
opts?: { commit?: boolean; attachmentDirs?: string[]; history?: string; role?: AgentRole },
```

Replace the inline `systemPrompt:` assembly (currently line 82) with the composer:

```typescript
        systemPrompt: composeSystemPrompt(deps, opts?.role ?? "desk"),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/query-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/query.ts test/query-prompt.test.ts
git commit -m "feat(desk): compose per-role system prompt; desk defaults to terse"
```

---

### Task 3: Route `remember`/ingest as the librarian

**Files:**
- Modify: `src/ingest.ts`

**Interfaces:**
- Consumes: `query()`'s `opts.role` from Task 2.

- [ ] **Step 1: Forward the librarian role**

In `src/ingest.ts`, `remember()` currently ends with `return query(deps, buildIngestInstruction(...), onProgress, opts);`. Change it to force the librarian role while preserving any other opts:

```typescript
  return query(deps, buildIngestInstruction(args.content, args.source, args.title), onProgress, { ...opts, role: "librarian" });
```

- [ ] **Step 2: Run the full suite to confirm no regressions**

Run: `npx vitest run`
Expected: all pass (existing count + the 2 new files from Tasks 1–2).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ingest.ts
git commit -m "feat(librarian): run remember/ingest with the librarian prompt (no desk terseness)"
```

---

### Task 4: End-to-end verification (desk terser, librarian intact)

**Files:** none (verification only).

- [ ] **Step 1: Restart the server on this branch**

The server does not hot-reload. Stop the running one and start fresh so it picks up the new code:

```bash
pkill -f "env-file=.env src/index.ts"; sleep 2
npx tsx --env-file=.env src/index.ts   # run in the background; wait for "kernel listening"
```

- [ ] **Step 2: Verify the desk is terser but still correct**

Ask the desk (via the dashboard chat or an MCP `query` call) the same probe as the baseline: *"Geef me het plan om de laatste 5 ProductFlow-producten op te halen."*
Expected: a plan that still names `productflow` / `list_products` with `per_page: 5` (correct), but **without** `##` headers or a multi-section strategy essay — noticeably shorter than the baseline output (~799 chars). Compare against `docs/design/2026-07-06-capability-foundation.md` → Baseline table.

- [ ] **Step 3: Verify the librarian is unaffected**

Send a `remember` (via the dashboard or MCP) with a small note.
Expected: it still files an OKF note and updates `index.md`/`log.md` as before — its output is NOT constrained by the desk terseness rule (it may still explain what it filed).

- [ ] **Step 4: Record the result**

Append the observed desk output size next to the baseline in the design doc's *Success metrics* table (as the "after (desk split)" figure), and commit that doc update:

```bash
git add docs/design/2026-07-06-capability-foundation.md
git commit -m "docs(design): record terser-desk after-figure vs baseline"
```

---

## Self-Review

- **Spec coverage:** implements the spec's *"Desk and librarian are separate agents"* decision at the prompt-composition level (shared core + role fragments, no cross-pollution, remember off the desk path). The rest of the foundation is explicitly out of scope (open questions) — noted in the header.
- **Placeholders:** none — every step has real code/commands. `LIBRARIAN_FRAGMENT` is intentionally empty (documented), not a placeholder.
- **Type consistency:** `AgentRole` and `fragmentFor` (Task 1) are used verbatim in Tasks 2–3; `composeSystemPrompt(deps, role)` signature matches its test and its call site.

## Follow-up (not this plan)

- Move filing/onboarding behaviour out of the shared core into `LIBRARIAN_FRAGMENT`, and decide whether onboarding/authoring runs as the librarian rather than the desk.
- The write-time compiled graph index, list_capabilities serialization (structured markdown + XML fences), retrieval/scoping, and backlog counting — each needs its own design pass then plan.

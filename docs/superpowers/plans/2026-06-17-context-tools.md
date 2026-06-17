# Context Tools (#2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `remember` (ingest), `list_capabilities` (discovery), and vault seeding + an enriched constitution to the Geode kernel, so the vault compounds and is discoverable.

**Architecture:** Reuse the kernel's machinery. `remember` is a thin wrapper over `delegate` (engine + run-manager + git + event-log) with an ingest-framed instruction. `list_capabilities` is a cheap read of `capabilities.md`. `seedVault` writes scaffold files on a fresh vault (idempotent); `index.ts` commits them. The constitution gains rules to maintain `index.md`/`capabilities.md`. Two new tools register in `server.ts`.

**Tech Stack:** Existing kernel stack — Node.js/TypeScript (NodeNext ESM), `@modelcontextprotocol/sdk` v1, `zod`, `vitest`. No new dependencies.

---

## Reused kernel interfaces (do not change)

- `delegate(deps: DelegateDeps, instruction: string, onProgress?): Promise<DelegateResult>` — `src/delegate.ts`
- `DelegateDeps = { workspace, engine, runManager, eventLog, systemPrompt, model? }`; `DelegateResult = { runId, text, commit, filesTouched }`
- `createWorkspace(root): Workspace` with `commitAll(msg): Promise<string|null>` — `src/workspace.ts`
- `McpServer.registerTool(name, { description, inputSchema }, handler)`; `buildMcpServer(delegateDeps)`; `buildHttpApp(makeServer, authToken)` — `src/server.ts`
- Test imports use `.js` extensions on `.ts` sources (NodeNext ESM).

## File Structure

| File | Responsibility |
|---|---|
| `src/ingest.ts` (create) | `buildIngestInstruction(content, source?, title?)` (pure) + `remember(deps, args, onProgress?)` (wraps `delegate`) |
| `src/capabilities.ts` (create) | `listCapabilities(root)` — read `capabilities.md` + absent-fallback |
| `src/seed.ts` (create) | `seedVault(root)` (idempotent scaffold writer) + scaffold template constants |
| `src/constitution.ts` (modify) | enrich the constitution string |
| `src/server.ts` (modify) | shared `runAgenticTool` helper; `makeRememberHandler`, `makeListCapabilitiesHandler`; register both tools |
| `src/index.ts` (modify) | call `seedVault` after `workspace.init()` and commit any scaffolds |
| `test/ingest.test.ts`, `test/capabilities.test.ts`, `test/seed.test.ts`, `test/constitution.test.ts` (create) | unit tests |
| `test/server.test.ts` (modify) | add remember + list_capabilities handler tests |
| `test/e2e.manual.md` (modify) | add a remember + list_capabilities manual check |

---

## Task 1: ingest — `buildIngestInstruction` + `remember`

**Files:** Create `src/ingest.ts`, `test/ingest.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/ingest.test.ts`:
```typescript
import { expect, test } from "vitest";
import { buildIngestInstruction, remember, type RememberArgs } from "../src/ingest.js";
import { createRunManager } from "../src/runManager.js";
import type { EngineEvent, EngineRunOptions } from "../src/engine.js";

test("buildIngestInstruction includes the framing and content; omits absent title/source", () => {
  const i = buildIngestInstruction("Client X wants net-30.");
  expect(i).toContain("Integrate the following into the vault");
  expect(i).toContain("Content:\nClient X wants net-30.");
  expect(i).not.toContain("Title hint:");
  expect(i).not.toContain("Source:");
});

test("buildIngestInstruction includes title and source when provided", () => {
  const i = buildIngestInstruction("net-30", "call 2026-06-17", "billing");
  expect(i).toContain("Title hint: billing");
  expect(i).toContain("Source: call 2026-06-17");
});

function fakeDeps(captured: { instruction?: string }) {
  return {
    workspace: {
      root: "/vault", init: async () => {}, isClean: async () => true, head: async () => "H0",
      commitAll: async () => "C1", resetToHead: async () => {}, changedFilesSince: async () => ["page.md"],
    },
    engine: async function* (opts: EngineRunOptions): AsyncIterable<EngineEvent> {
      captured.instruction = opts.instruction;
      yield { type: "result", text: "filed it" };
    },
    runManager: createRunManager({ maxRuntimeMs: 1000, queueLimit: 4 }),
    eventLog: { append: async () => {} },
    systemPrompt: "SYS",
  } as any;
}

test("remember runs delegate with the ingest instruction and returns the result", async () => {
  const captured: { instruction?: string } = {};
  const args: RememberArgs = { content: "Client X wants net-30.", source: "call" };
  const res = await remember(fakeDeps(captured), args);
  expect(captured.instruction).toContain("Integrate the following into the vault");
  expect(captured.instruction).toContain("Client X wants net-30.");
  expect(res.text).toBe("filed it");
});

test("remember rejects empty content", async () => {
  await expect(remember(fakeDeps({}), { content: "   " })).rejects.toThrow(/content/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ingest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/ingest.ts`:
```typescript
import { delegate, type DelegateDeps, type DelegateResult } from "./delegate.js";

export interface RememberArgs {
  content: string;
  source?: string;
  title?: string;
  workspace?: string;
}

export function buildIngestInstruction(content: string, source?: string, title?: string): string {
  const lines = [
    "Integrate the following into the vault: find or create the right page for it, dedup against existing content, add cross-references, update index.md and capabilities.md if relevant, and keep it tidy. Then summarize what you filed and where.",
  ];
  if (title) lines.push(`Title hint: ${title}`);
  if (source) lines.push(`Source: ${source}`);
  lines.push(`Content:\n${content}`);
  return lines.join("\n");
}

export async function remember(
  deps: DelegateDeps,
  args: RememberArgs,
  onProgress?: (message: string) => void,
): Promise<DelegateResult> {
  if (!args.content || !args.content.trim()) {
    throw new Error("remember: content is required and cannot be empty");
  }
  return delegate(deps, buildIngestInstruction(args.content, args.source, args.title), onProgress);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ingest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest.ts test/ingest.test.ts
git commit -m "feat: remember (ingest) — wraps delegate with an ingest instruction"
```

---

## Task 2: `listCapabilities`

**Files:** Create `src/capabilities.ts`, `test/capabilities.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/capabilities.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCapabilities } from "../src/capabilities.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-cap-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("returns capabilities.md contents when present", async () => {
  writeFileSync(join(root, "capabilities.md"), "# Capabilities\n\n- brand voice\n");
  const out = await listCapabilities(root);
  expect(out).toContain("brand voice");
});

test("returns a friendly fallback when capabilities.md is absent", async () => {
  const out = await listCapabilities(root);
  expect(out).toMatch(/no capabilities manifest yet/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/capabilities.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/capabilities.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function listCapabilities(root: string): Promise<string> {
  try {
    return await readFile(join(root, "capabilities.md"), "utf8");
  } catch {
    return "No capabilities manifest yet — add context with `remember` or run a task with `delegate` to populate it.";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/capabilities.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/capabilities.ts test/capabilities.test.ts
git commit -m "feat: list_capabilities backing read of capabilities.md"
```

---

## Task 3: `seedVault` + scaffold templates

**Files:** Create `src/seed.ts`, `test/seed.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/seed.test.ts`:
```typescript
import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedVault } from "../src/seed.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-seed-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("creates the three scaffold files on a fresh vault", async () => {
  const created = await seedVault(root);
  expect(created.sort()).toEqual(["AGENTS.md", "capabilities.md", "index.md"]);
  expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  expect(existsSync(join(root, "index.md"))).toBe(true);
  expect(existsSync(join(root, "capabilities.md"))).toBe(true);
});

test("is idempotent and never overwrites an existing file", async () => {
  writeFileSync(join(root, "AGENTS.md"), "MY EDITED SCHEMA");
  const created = await seedVault(root);
  expect(created.sort()).toEqual(["capabilities.md", "index.md"]); // AGENTS.md left alone
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("MY EDITED SCHEMA");
  expect(await seedVault(root)).toEqual([]); // second run creates nothing
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/seed.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

`src/seed.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/seed.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/seed.ts test/seed.test.ts
git commit -m "feat: idempotent vault seeding (AGENTS.md, index.md, capabilities.md)"
```

---

## Task 4: Enrich the constitution

**Files:** Modify `src/constitution.ts`; Create `test/constitution.test.ts`.

- [ ] **Step 1: Write the failing test**

`test/constitution.test.ts`:
```typescript
import { expect, test } from "vitest";
import { CONSTITUTION } from "../src/constitution.js";

test("constitution instructs maintaining the structural files and inheritance rules", () => {
  expect(CONSTITUTION).toContain("index.md");
  expect(CONSTITUTION).toContain("capabilities.md");
  expect(CONSTITUTION).toContain("AGENTS.md");
  expect(CONSTITUTION.toLowerCase()).toContain("canonical");
  expect(CONSTITUTION.toLowerCase()).toContain("cascade");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/constitution.test.ts`
Expected: FAIL (`capabilities.md`/`cascade` not yet referenced).

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/constitution.ts` with:
```typescript
export const CONSTITUTION = `You are the agent inside a user's Geode vault: a structured, git-backed directory of their personal context, recipes, and knowledge.

Discipline (always):
- Treat the working directory as a maintained vault, not a scratchpad. Follow the AGENTS.md schema in this vault.
- After any change, keep index.md current (a catalog of pages with one-line summaries + links) and append a concise line to log.md.
- Keep capabilities.md current: list the vault's recipes/skills and connected integrations, each with a one-line description.
- Canonical facts live in exactly one file; reference them by path, never copy. Rules/conventions defined higher in the tree cascade to everything below — don't restate them.
- Never write secrets into files. Secrets are injected at runtime; you only see reference names.
- Prefer small, well-placed edits over large rewrites. Explain what you changed.

You have full read/write/bash/tool access. Every run is committed to git, so changes are recoverable; work decisively but tidily.`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/constitution.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/constitution.ts test/constitution.test.ts
git commit -m "feat: enrich constitution (maintain capabilities.md + cascade/canonical rules)"
```

---

## Task 5: Register `remember` + `list_capabilities` in the server

**Files:** Modify `src/server.ts`, `test/server.test.ts`.

- [ ] **Step 1: Write the failing tests (append to `test/server.test.ts`)**

Add these imports/tests to `test/server.test.ts`:
```typescript
import { makeRememberHandler, makeListCapabilitiesHandler } from "../src/server.js";

test("remember handler returns result text + structured content and forwards progress", async () => {
  const sent: any[] = [];
  const handler = makeRememberHandler({
    runRemember: async (_args: any, onProgress?: (m: string) => void) => {
      onProgress?.("ingesting");
      return { runId: "run-1", text: "filed under brand/voice.md", commit: "C1", filesTouched: ["brand/voice.md"] };
    },
  } as any);
  const extra = { _meta: { progressToken: 3 }, sendNotification: async (n: any) => { sent.push(n); } };
  const res = await handler({ content: "x" }, extra);
  expect(res.content[0].text).toBe("filed under brand/voice.md");
  expect(res.structuredContent.filesTouched).toEqual(["brand/voice.md"]);
  expect(sent[0].params.progressToken).toBe(3);
});

test("remember handler returns a structured error when the run throws", async () => {
  const handler = makeRememberHandler({ runRemember: async () => { throw new Error("boom"); } } as any);
  const res = await handler({ content: "x" }, {});
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain("boom");
});

test("list_capabilities handler returns the manifest text", async () => {
  const handler = makeListCapabilitiesHandler({ root: "/vault", list: async () => "# Capabilities\n- voice" });
  const res = await handler({}, {});
  expect(res.content[0].text).toContain("Capabilities");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL (`makeRememberHandler`/`makeListCapabilitiesHandler` not exported).

- [ ] **Step 3: Write the implementation**

In `src/server.ts`, add the import for ingest/capabilities near the existing imports:
```typescript
import { remember, type RememberArgs } from "./ingest.js";
import { listCapabilities } from "./capabilities.js";
```

Add a shared helper and refactor `makeDelegateHandler` to use it, then add the two new handlers. Replace the existing **`DelegateHandlerDeps` interface and `makeDelegateHandler` function** (the contiguous block) with the following — behavior of `makeDelegateHandler` is identical, it just delegates to the shared `runAgenticTool`:
```typescript
// Shared runner for agentic tools (delegate, remember): streams progress and
// returns text + structured content, or a structured error on throw.
async function runAgenticTool(
  extra: any,
  run: (onProgress: (m: string) => void) => Promise<DelegateResult>,
  label: string,
) {
  let progress = 0;
  const token = extra?._meta?.progressToken;
  const onProgress = (message: string) => {
    if (token !== undefined && typeof extra?.sendNotification === "function") {
      void extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: ++progress, message },
      });
    }
  };
  try {
    const result = await run(onProgress);
    return {
      content: [{ type: "text" as const, text: result.text }],
      structuredContent: { runId: result.runId, commit: result.commit, filesTouched: result.filesTouched },
    };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `${label} failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}

export interface DelegateHandlerDeps {
  runDelegate: (instruction: string, onProgress?: (m: string) => void) => Promise<DelegateResult>;
}
export function makeDelegateHandler(deps: DelegateHandlerDeps) {
  return async (args: { instruction: string; workspace?: string }, extra: any) =>
    runAgenticTool(extra, (op) => deps.runDelegate(args.instruction, op), "delegate");
}

export interface RememberHandlerDeps {
  runRemember: (args: RememberArgs, onProgress?: (m: string) => void) => Promise<DelegateResult>;
}
export function makeRememberHandler(deps: RememberHandlerDeps) {
  return async (args: RememberArgs, extra: any) =>
    runAgenticTool(extra, (op) => deps.runRemember(args, op), "remember");
}

export interface ListCapabilitiesHandlerDeps {
  root: string;
  list: (root: string) => Promise<string>;
}
export function makeListCapabilitiesHandler(deps: ListCapabilitiesHandlerDeps) {
  return async (_args: unknown, _extra: unknown) => ({
    content: [{ type: "text" as const, text: await deps.list(deps.root) }],
  });
}
```

In `buildMcpServer`, after the existing `delegate` tool registration and before `return server;`, register the two new tools:
```typescript
  const rememberHandler = makeRememberHandler({
    runRemember: (args, onProgress) => remember(delegateDeps, args, onProgress),
  });
  server.registerTool(
    "remember",
    {
      description: "Save a distilled learning, fact, or note in your Geode vault. Give the essence — not a whole conversation; the vault agent integrates, dedups, and files it. Example — content: 'Client X wants invoices on the 1st, net-30.', source: 'call 2026-06-17'.",
      inputSchema: {
        content: z.string().describe("The knowledge to save — a distilled, self-contained learning, fact, or note (not a raw transcript); one idea is fine."),
        source: z.string().optional().describe("Where it came from, for provenance (e.g. 'Claude chat 2026-06-17', a URL, a person)."),
        title: z.string().optional().describe("A short hint of what this is about, to help filing (the agent refines it)."),
        workspace: z.string().optional(),
      },
    },
    rememberHandler,
  );

  const listCapabilitiesHandler = makeListCapabilitiesHandler({ root: delegateDeps.workspace.root, list: listCapabilities });
  server.registerTool(
    "list_capabilities",
    {
      description: "List what your Geode vault offers — recipes/skills and integrations with their actions. Cheap; call this to learn what the vault can do before delegating.",
      inputSchema: {},
    },
    listCapabilitiesHandler,
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (existing find/delegate/auth tests + the 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "feat: register remember + list_capabilities tools (shared agentic-tool runner)"
```

---

## Task 6: Seed the vault at startup

**Files:** Modify `src/index.ts`.

- [ ] **Step 1: Add seeding to `main()`**

In `src/index.ts`, add the import:
```typescript
import { seedVault } from "./seed.js";
```
And immediately after `await workspace.init();` add:
```typescript
  const seeded = await seedVault(config.workspaceRoot);
  if (seeded.length > 0) await workspace.commitAll(`chore: seed vault scaffolds (${seeded.join(", ")})`);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: seed vault scaffolds on startup and commit them"
```

---

## Task 7: Extend the manual e2e checklist

**Files:** Modify `test/e2e.manual.md`.

- [ ] **Step 1: Append a remember + list_capabilities section**

Append to `test/e2e.manual.md`:
```markdown

## Context tools (#2) — manual checks

7. Call `list_capabilities` (no args) on a freshly-seeded vault → expect the seeded
   `capabilities.md` content (or the fallback note if seeding/maintenance hasn't run).
8. Call `remember` with `{ "content": "Client X prefers invoices on the 1st, net-30 terms.", "source": "call 2026-06-17", "title": "Client X billing" }`.
   - Expect: progress streams, a summary of what was filed where, and `isError` is false.
   - Verify in `$GEODE_WORKSPACE`: a new `delegate run-… : …` commit + `delegate run-… : log` commit;
     the content filed into a page (e.g. under a `clients/` or similar path); `index.md` updated;
     `capabilities.md` possibly updated; an `ok` entry in `log.md`.
9. Call `list_capabilities` again → expect it now reflects any capability the agent recorded.
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e.manual.md
git commit -m "docs: manual e2e checks for remember + list_capabilities"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite + build**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (kernel's 29 + the new ingest/capabilities/seed/constitution/server tests), `tsc` clean.

- [ ] **Step 2: Commit (only if a fixup was needed)**

If any wiring fix was required, commit it:
```bash
git add -A && git commit -m "fix: wire-up corrections for context tools"
```

---

## Notes for the implementer

- DRY/YAGNI: do not build the autonomous lint, `invoke`/integrations, the dashboard, or multi-workspace — those are later sub-projects.
- `remember` runs the full agent (bypassPermissions, git-protected) — same posture as `delegate`; no new security surface.
- Determinism: unit tests mock the engine / use temp dirs. The live agent ingest quality is validated only by the manual e2e (Task 7).
- Keep exported names exactly as written (later tasks and the spec depend on them).

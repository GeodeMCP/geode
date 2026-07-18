# Vault Meta-Layer Rationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `index.md` + `.geode/graph.json` truly generated-only and remove the redundant hand-maintained meta-files (`log.md`, `MEMORY.md`, `memory/`), so the vault stops mixing pre-graph (hand-edited) and after-graph (generated) state.

**Architecture:** Runtime (dashboard + MCP) already runs on `graph.json`; the markdown meta-files exist only for export self-sufficiency. We (1) extract one `regenerateArtifacts()` helper used by every rebuild site, (2) add a permission-handler deny so the agent can't hand-edit generated files, (3) run the rebuild on the dashboard commit path (today it only runs at startup / on the MCP auto-commit path), (4) drop the "append to log.md" rule and the `log.md` writer, and (5) migrate the vault to remove the dead files.

**Tech Stack:** TypeScript (ESM, `type: module`, `.js` import specifiers), Node, Vitest, Express, Claude Agent SDK. Spec: `docs/superpowers/specs/2026-07-18-vault-meta-layer-design.md`.

## Global Constraints

- **English-only** for all in-app/UI strings and code strings (deny messages, log lines). Comments follow existing style.
- **Husky pre-commit gate:** every newly exported function needs a JSDoc comment or the commit is blocked.
- **TDD:** write the failing test first, watch it fail, implement, watch it pass, commit.
- **ESM:** all local imports use the `.js` extension (e.g. `"./rebuild.js"`).
- **Run a single test file:** `npx vitest run test/<file>.test.ts`. **Full suite:** `npx vitest run`.
- **Scope note (refines spec §6.3):** this plan *drops* the `log.md` writer rather than re-pointing run telemetry to the transcript store. Surfacing MCP runs in the dashboard timeline is a separate, pre-existing backlog item ("MCP runs in timeline") and is out of scope here.

---

### Task 1: Extract `regenerateArtifacts()` and use it at every rebuild site

**Files:**
- Create: `src/rebuild.ts`
- Create: `test/rebuild.test.ts`
- Modify: `src/query.ts:126-135` (rebuild block), `src/query.ts:11-12` (imports)
- Modify: `src/index.ts:51-53` (startup rebuild), `src/index.ts:14-15` (imports)
- Modify: `src/graphCli.ts:14-17` (CLI rebuild), `src/graphCli.ts:3-4` (imports)

**Interfaces:**
- Produces: `regenerateArtifacts(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultGraph>` — builds the graph, writes `.geode/graph.json` and `index.md`, returns the graph.

- [ ] **Step 1: Write the failing test**

Create `test/rebuild.test.ts`:

```ts
import { expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerateArtifacts } from "../src/rebuild.js";

test("regenerateArtifacts writes graph.json + index.md and returns the graph", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-rebuild-"));
  writeFileSync(join(root, "note.md"), "---\ntype: note\ntitle: A Note\ndescription: hi\n---\nbody\n");
  const graph = await regenerateArtifacts(root, { get: async () => null });
  expect(existsSync(join(root, ".geode/graph.json"))).toBe(true);
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("A Note");
  expect(graph.nodes.some((n) => n.title === "A Note")).toBe(true);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rebuild.test.ts`
Expected: FAIL — cannot find module `../src/rebuild.js`.

- [ ] **Step 3: Create `src/rebuild.ts`**

```ts
import { buildGraph, writeGraph, type VaultGraph } from "./graph.js";
import { writeIndex } from "./indexRender.js";
import type { SecretStore } from "./secrets.js";

/**
 * Rebuilds the vault's derived artifacts from its content: compiles the capability graph,
 * writes `.geode/graph.json`, and regenerates `index.md`. Deterministic — the files only
 * change (and thus only produce a git diff) when vault content changed. Returns the compiled
 * graph so callers can report on it.
 */
export async function regenerateArtifacts(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultGraph> {
  const graph = await buildGraph(root, secrets);
  await writeGraph(root, graph);
  await writeIndex(root, graph);
  return graph;
}
```

(If `SecretStore` is not exported from `src/secrets.ts`, import it from wherever `src/graph.ts` imports it — match `graph.ts`'s existing import of `SecretStore`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rebuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `src/query.ts` to use the helper**

Replace the imports at `src/query.ts:11-12`:
```ts
import { loadGraph } from "./graph.js";        // keep only what query still uses (loadGraph/selectSubgraph etc.)
import { regenerateArtifacts } from "./rebuild.js";
```
(Keep any other `graph.js` imports query still needs — e.g. `loadGraph`, `selectSubgraph`, `renderScopedContext`. Only `buildGraph`/`writeGraph`/`writeIndex` become unused here.)

Replace the rebuild block (currently `src/query.ts:132-134`) inside the `if (deps.secrets) { try { … } }`:
```ts
          await regenerateArtifacts(deps.workspace.root, deps.secrets);
          await deps.workspace.commitAll(`graph: rebuild ${runId}`);
```

- [ ] **Step 6: Refactor `src/index.ts` and `src/graphCli.ts`**

`src/index.ts` — replace imports at `14-15` and the startup rebuild at `51-53`:
```ts
import { regenerateArtifacts } from "./rebuild.js";
// …
  await regenerateArtifacts(config.workspaceRoot, secrets);
```
(Remove the now-unused `buildGraph`/`writeGraph`/`writeIndex` imports if nothing else in the file uses them.)

`src/graphCli.ts` — replace imports at `3-4` and lines `14-17`:
```ts
import { regenerateArtifacts } from "./rebuild.js";
// …
  const graph = await regenerateArtifacts(root, secrets);
  console.log(`graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
```

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run test/rebuild.test.ts test/query.test.ts`
Expected: PASS. (`query.test.ts` lines ~184-199 still assert the `graph: rebuild` commit and `index.md` regeneration — behavior is unchanged.)

- [ ] **Step 8: Typecheck + commit**

Run: `npm run typecheck`
Expected: no errors.
```bash
git add src/rebuild.ts test/rebuild.test.ts src/query.ts src/index.ts src/graphCli.ts
git commit -m "refactor: extract regenerateArtifacts() for the graph+index rebuild"
```

---

### Task 2: Deny agent hand-edits to generated files

**Files:**
- Modify: `src/agentSandbox.ts` (imports; add `GENERATED_FILES`; add check in `buildPermissionHandler`)
- Modify: `test/agentSandbox.test.ts` (new cases in the `buildPermissionHandler` describe block)

**Interfaces:**
- Consumes: existing `buildPermissionHandler(writeRoots: string[])` and `canonicalPath`.

- [ ] **Step 1: Write the failing tests**

In `test/agentSandbox.test.ts`, inside `describe("buildPermissionHandler", …)` (after the existing confinement cases), add:
```ts
  it("denies hand-edits to generated artifacts (index.md, .geode/graph.json)", async () => {
    expect((await handler("Write", { file_path: "index.md" })).behavior).toBe("deny");
    expect((await handler("Edit", { file_path: "/vault/index.md" })).behavior).toBe("deny");
    expect((await handler("Write", { file_path: ".geode/graph.json" })).behavior).toBe("deny");
    expect((await handler("MultiEdit", { file_path: "/vault/.geode/graph.json" })).behavior).toBe("deny");
  });
  it("still allows writes to ordinary vault files", async () => {
    expect((await handler("Write", { file_path: "business/x.md" })).behavior).toBe("allow");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agentSandbox.test.ts`
Expected: FAIL — the four generated-file writes currently return `allow`.

- [ ] **Step 3: Implement the guard**

In `src/agentSandbox.ts`, add `relative` to the `node:path` import:
```ts
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
```
Add a constant next to `WRITE_TOOLS`:
```ts
// Derived artifacts the agent must never hand-edit — the kernel regenerates them from the
// vault graph on every commit. Paths are vault-relative (POSIX separators).
const GENERATED_FILES = new Set(["index.md", ".geode/graph.json"]);
```
Inside `buildPermissionHandler`, in the `if (WRITE_TOOLS.has(toolName))` block, immediately after the confinement check (`if (typeof path !== "string" || !writeAllowed(path, roots)) return deny(…)`), add:
```ts
      const base = roots[0] ?? "";
      const rel = relative(base, canonicalPath(isAbsolute(path) ? path : join(base, path))).replace(/\\/g, "/");
      if (GENERATED_FILES.has(rel)) {
        return deny(`${rel} is generated from the vault graph and rebuilt automatically — do not edit it by hand`);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agentSandbox.test.ts`
Expected: PASS (all cases, including the pre-existing confinement + manifest-validation ones).

- [ ] **Step 5: Commit**
```bash
git add src/agentSandbox.ts test/agentSandbox.test.ts
git commit -m "feat(sandbox): deny agent hand-edits to generated index.md + graph.json"
```

---

### Task 3: Rebuild generated files on the dashboard commit path

**Files:**
- Modify: `src/dashboard/api.ts` (import `regenerateArtifacts`; the `POST /commit` handler at `171-174`)
- Modify: `test/dashboard/api.test.ts` (add `get` to the secrets stub in `boot()`; new `/commit` test)

**Interfaces:**
- Consumes: `regenerateArtifacts` (Task 1); `deps.secrets` (has `get`); `deps.workspace.commitAll`.

- [ ] **Step 1: Write the failing test**

In `test/dashboard/api.test.ts`, first add `get` to the secrets stub in `boot()` (line ~42) so the rebuild can read the graph:
```ts
    secrets: { get: async () => null, list: async () => [], delete: async () => {}, set: async () => {} } as any,
```
Add `readFileSync`/`existsSync` to the `node:fs` import at the top, then add this test:
```ts
test("POST /commit regenerates index.md + graph.json into the same commit", async () => {
  const cookie = await login();
  writeFileSync(join(root, "hello.md"), "---\ntype: note\ntitle: Hello Note\ndescription: hi\n---\nbody\n");
  const res = await fetch(`${url}/api/commit`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ message: "add hello" }),
  });
  expect(res.status).toBe(200);
  expect(readFileSync(join(root, "index.md"), "utf8")).toContain("Hello Note");
  expect(existsSync(join(root, ".geode/graph.json"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dashboard/api.test.ts`
Expected: FAIL — `index.md` still contains the seeded `# Index` (no rebuild on commit), so it does not contain "Hello Note".

- [ ] **Step 3: Implement**

In `src/dashboard/api.ts`, add the import:
```ts
import { regenerateArtifacts } from "../rebuild.js";
```
Replace the `POST /commit` handler (`171-174`) with:
```ts
  router.post("/commit", async (req, res) => {
    try { await regenerateArtifacts(deps.workspace.root, deps.secrets); }
    catch (e) { console.error("graph rebuild failed (non-fatal):", e instanceof Error ? e.message : String(e)); }
    const commit = await deps.workspace.commitAll(String(req.body?.message || "dashboard: commit changes"));
    res.json({ commit });
  });
```
(The `deps.secrets` type is `Pick<SecretStore, "get" | "list" | "delete" | "set">`, which satisfies `regenerateArtifacts`'s `Pick<SecretStore, "get">`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dashboard/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/dashboard/api.ts test/dashboard/api.test.ts
git commit -m "feat(dashboard): rebuild index.md + graph.json on the /commit path"
```

---

### Task 4: Drop the log-maintenance rule from the constitution + prompt

**Files:**
- Modify: `src/constitution.ts:6`
- Modify: `src/query.ts:89` (the onboarding attachment note)
- Modify: `test/constitution.test.ts:11` (remove the `log.md` assertion)

- [ ] **Step 1: Update the failing test first**

In `test/constitution.test.ts`, remove line 11 (`expect(CONSTITUTION).toContain("log.md");`) and add an assertion that the log rule is gone plus the generated-files rule is present:
```ts
  expect(CONSTITUTION).not.toContain("log.md");                 // hand log retired
  expect(CONSTITUTION.toLowerCase()).toContain("generated");    // index.md/graph.json are generated
```
(The existing `expect(CONSTITUTION.toLowerCase()).toContain("generated")` at line 12 may already cover the second one; keep a single copy.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/constitution.test.ts`
Expected: FAIL — `CONSTITUTION` still contains `log.md`.

- [ ] **Step 3: Edit the constitution**

In `src/constitution.ts`, replace line 6:
```
- After any change, append a concise line to log.md. index.md is generated from the vault — never edit it by hand.
```
with:
```
- index.md and .geode/graph.json are generated from the vault — never edit them by hand; the kernel rebuilds them automatically after every change.
```

- [ ] **Step 4: Edit the onboarding note in `query.ts`**

In `src/query.ts:89`, in the attachment/onboarding note string, change `keep log.md current, and report what you filed` to `and report what you filed` (drop `keep log.md current, `).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/constitution.test.ts test/query-prompt.test.ts test/query.test.ts`
Expected: PASS. (If any other test asserts the `log.md` substring in a prompt, run `grep -rn "log.md" test/` and update those assertions the same way.)

- [ ] **Step 6: Commit**
```bash
git add src/constitution.ts src/query.ts test/constitution.test.ts
git commit -m "refactor(prompt): retire the hand-maintained log.md rule from the constitution"
```

---

### Task 5: Remove the `eventLog` (log.md) writer

**Files:**
- Delete: `src/eventLog.ts`, `test/eventLog.test.ts`
- Modify: `src/query.ts` (remove `EventLog` import + `eventLog` dep + the two `append` calls + the `query …: log` / `log (error)` commits)
- Modify: `src/index.ts:3,69` (remove `createEventLog` import + wiring)
- Modify: `test/query.test.ts` (remove the `fakeLog` helper + `eventLog` from `deps`; update the two tests that assert the log commits)
- Modify: `test/query.reviewmode.test.ts:25` (remove `eventLog` from `deps`)

- [ ] **Step 1: Update the failing tests first**

In `test/query.test.ts`:
- Remove the `fakeLog` helper and the `eventLog: fakeLog() as any` line from `deps` (line ~42).
- Rewrite the success test (lines ~49-60) to drop the log expectations:
```ts
test("on success: streams progress, commits agent changes, returns result + files", async () => {
  const d = deps({});
  const res = await query(d, "do X");
  expect(res.text).toBe("done");                                   // or the engine's result text used in this file
  expect((d.workspace as any).calls).toContain("commit:query run-1: do X");
  expect((d.workspace as any).calls).not.toContain("commit:query run-1: log");
});
```
- Rewrite the error test (lines ~66-72) to assert the non-review error path resets and rethrows, with no log-error commit:
```ts
test("on failure (non-review): resets the tree and rethrows, no log commit", async () => {
  const ws = fakeWorkspace();
  const boom = async function* () { throw new Error("boom"); };
  const d = deps({ workspace: ws as any, engine: boom as any });
  await expect(query(d, "do X")).rejects.toThrow("boom");
  expect(ws.calls).toContain("reset");
  expect(ws.calls.some((c: string) => c.includes("log (error)"))).toBe(false);
});
```
(Match the existing `fakeWorkspace`/`deps` shapes in this file; the review-mode failure test at ~97-103 already asserts no `log (error)` commit and stays valid.)

In `test/query.reviewmode.test.ts`, remove the `eventLog: { append: async () => {} } as any,` line from `deps` (line 25).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/query.test.ts`
Expected: FAIL — `eventLog` is still a required field on `QueryDeps` / referenced in `query.ts`, or the old assertions no longer match.

- [ ] **Step 3: Remove `eventLog` from `src/query.ts`**

- Remove `import type { EventLog } from "./eventLog.js";` (line 4).
- Remove `eventLog: EventLog;` from the `QueryDeps` interface (line 22).
- Remove the success append + log commit (lines 122-125), leaving:
```ts
      const commit = await deps.workspace.commitAll(`query ${runId}: ${truncate(instruction, 60)}`);
      const filesTouched = commit ? await deps.workspace.changedFilesSince(before) : [];
```
  (i.e. delete the `deps.eventLog.append(...)` line, the two-line comment about persisting the log entry, and the `await deps.workspace.commitAll(\`query ${runId}: log\`);` line.)
- In the catch block (lines 151-155), remove the append + the `log (error)` commit, leaving:
```ts
      if (!review) {
        await deps.workspace.resetToHead();
      }
      throw err;
```

- [ ] **Step 4: Remove the wiring + files**

- `src/index.ts`: remove `import { createEventLog } from "./eventLog.js";` (line 3) and the `eventLog: createEventLog(config.workspaceRoot),` dep (line 69).
- Delete the files:
```bash
git rm src/eventLog.ts test/eventLog.test.ts
```

- [ ] **Step 5: Run the affected suites + typecheck**

Run: `npx vitest run test/query.test.ts test/query.reviewmode.test.ts && npm run typecheck`
Expected: PASS, no type errors. (Then `npx vitest run` for the whole suite; fix any other file that still passes `eventLog` into `QueryDeps`.)

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "refactor: remove the eventLog log.md writer (no reader; git is the history)"
```

---

### Task 6: Migrate the vault (`~/geode-vault`)

This task runs against the **vault repo**, not the kernel repo. It removes the dead files and refreshes the generated + convention files with the new code. Do it after Tasks 1-5 are merged and a fresh kernel is running the new code.

**Files (in `~/geode-vault`):**
- Delete: `log.md`, `MEMORY.md`, `memory/`
- Modify: `AGENTS.md` (folder map + generated-files note)
- Regenerate: `index.md`, `.geode/graph.json`

- [ ] **Step 1: Remove the dead files**
```bash
cd ~/geode-vault
git rm log.md MEMORY.md
git rm -r memory/
```

- [ ] **Step 2: Fix `AGENTS.md`**

Update the `## Folder map` to the current structure and add the generated-files fact. Replace the `business/` bullet block with:
```markdown
- `business/` — notes & summaries, grouped per subject
  - `business/shared-knowledge/` — cross-company reference knowledge & SOPs (bookkeeping basics, Moneybird conventions, booking heuristics, the booking/contact/invoice SOPs)
  - `business/mijnwebontwikkelaar/` — per-company notes (incl. `admin/`, the canonical `booking-patterns.yml`)
  - `business/epicwpsolutions/` — per-company notes (incl. `admin/`)
- `tools/` — authored TOOL.md manifests per tool
- `backlog/` — capability gaps (`type: gap`, `kind: tool|context|sop|skill`) still to be onboarded/built
```
Add to `## Conventions`:
```markdown
- `index.md` and `.geode/graph.json` are generated from the vault graph and rebuilt automatically — never edit them by hand.
```

- [ ] **Step 3: Regenerate `index.md` + `graph.json` with the new code**
```bash
cd /Users/robbertvermeulen/Projects/geodemcp-2
GEODE_WORKSPACE=/Users/robbertvermeulen/geode-vault npx tsx --env-file=.env src/graphCli.ts
```
Expected: prints `graph: N nodes, M edges`; `~/geode-vault/index.md` no longer lists any removed file, and its administratie entries point at the current `shared-knowledge/` / per-company paths.

- [ ] **Step 4: Commit the vault**
```bash
cd ~/geode-vault
git add -A
git commit -m "housekeeping: drop log.md + MEMORY.md/memory/; refresh AGENTS.md + generated index"
```

- [ ] **Step 5: Verify end-to-end**

Restart the kernel, run one dashboard edit, click Commit, and confirm: (a) `index.md` reflects the edit in the same commit (no stale window), (b) an agent attempt to `Write` `index.md` is denied, (c) no new `log.md` / `MEMORY.md` reappears.

---

## Self-Review

- **Spec coverage:** §4 keep/cut → Tasks 5 (log.md) + 6 (MEMORY.md/memory/, index.md regen, AGENTS.md); §6.1 guardrail → Task 2; §6.2 rebuild-on-commit → Tasks 1+3; §6.3 drop log rule/writer → Tasks 4+5; §7 migration → Task 6; §9 success criteria → Task 6 Step 5. Covered.
- **Deviation flagged:** spec §6.3 said "unify onto the transcript store"; this plan drops the writer instead (MCP-in-dashboard is a separate backlog item) — noted in Global Constraints.
- **Type consistency:** `regenerateArtifacts(root, Pick<SecretStore,"get">): Promise<VaultGraph>` is defined in Task 1 and consumed identically in Tasks 1, 3, and 6.
- **Placeholder scan:** no TBD/TODO; every code + test step shows the actual content.

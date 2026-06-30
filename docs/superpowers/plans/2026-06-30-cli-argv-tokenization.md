# CLI argv tokenization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the whitespace-split that shatters quoted cli commands with a structural argv-array action form (`ToolAction.command: string[]`), eliminating an argv-injection class.

**Architecture:** `command` becomes a per-element argv array (each element template-resolved, never split). `bin` stays a static interpreter prefix (whitespace-split, then each token resolved). Final container argv = `[...binTokens, ...command]`, handed verbatim to the existing no-shell `docker run` exec form.

**Tech Stack:** TypeScript ESM, vitest, yaml frontmatter manifests.

**Spec:** `docs/superpowers/specs/2026-06-30-cli-argv-tokenization-design.md`

---

### Task 1: argv-array command form (atomic — schema + validation + executor + fixtures + SOP)

This is one atomic change: the type, the validator, the executor, and every `command:` fixture must flip from string to `string[]` together, or the suite is left in a broken in-between state. Do it in one TDD pass.

**Files:**
- Modify: `src/tools.ts` (`ToolAction.command` type + `loadTool` validation)
- Modify: `src/sandboxRun.ts:25,42` (argv construction)
- Modify: `kernel-skills/onboard-tool.md` (worked example → array form + one-line note)
- Test: `test/sandboxRun.test.ts`, `test/tools.test.ts` (new assertions + fixture migration)
- Migrate fixtures only: `test/invoke.test.ts:33`, `test/installer.test.ts:17`, `test/docker.test.ts:10`, `test/integration/fixture-tool/tools/echo-tool/TOOL.md`

- [ ] **Step 1: Write failing tests — the no-breakout guarantee + argv shape**

In `test/sandboxRun.test.ts`, using the existing stub-Docker pattern in that file (capture the args passed to `docker.run`), add:

```ts
it("keeps a spaced/quoted param value as a single argv element (no breakout)", async () => {
  const captured = await runFetchCapturingArgs({ url: "http://x/ a' b" });
  // captured = the argv after the image tag
  expect(captured).toContain("http://x/ a' b"); // exactly one element, unsplit
  expect(captured.filter((t) => t.includes("a'"))).toHaveLength(1);
});

it("builds a multiline -c script as one argv element", async () => {
  // tool: bin "python", action command ["-c", "print('${params.x}')"]
  const captured = await runActionCapturingArgs("script", { x: "hi" });
  expect(captured).toEqual(["python", "-c", "print('hi')"]);
});

it("splits a multi-token bin into separate argv tokens", async () => {
  // tool: bin "node dist/cli.js", action command ["fetch"]
  const captured = await runActionCapturingArgs("fetch", {});
  expect(captured.slice(0, 3)).toEqual(["node", "dist/cli.js", "fetch"]);
});
```

Adapt the helper(s) to however `test/sandboxRun.test.ts` already constructs `runCliTool` with a stub Docker + installed-state. The captured argv = the portion of `runArgs` output after the image `tag`. Manifest fixtures in this test use the new array `command` form.

In `test/tools.test.ts`, add loadTool validation tests:

```ts
it("rejects the old space-separated string command form", async () => {
  // write a manifest with `command: "fetch --url x"`
  await expect(loadTool(root, "legacy")).rejects.toThrow(/array of argv tokens/);
});

it("rejects an empty command array", async () => {
  // write a manifest with `command: []`
  await expect(loadTool(root, "empty")).rejects.toThrow(/array of argv tokens/);
});
```

- [ ] **Step 2: Run the new tests — verify they fail**

Run: `npx vitest run test/sandboxRun.test.ts test/tools.test.ts`
Expected: the new tests FAIL (string command still split; no validation yet).

- [ ] **Step 3: Change the schema + add validation in `src/tools.ts`**

- `ToolAction.command?: string` → `command?: string[]`.
- In `loadTool`, after parsing frontmatter, validate each action:

```ts
for (const [name, action] of Object.entries(fm.actions as Record<string, ToolAction>)) {
  if (action.command !== undefined &&
      (!Array.isArray(action.command) || action.command.length === 0 ||
       !action.command.every((t) => typeof t === "string"))) {
    throw new Error(`tool ${id}: action "${name}" — command must be a non-empty array of argv tokens (string[]); the space-separated string form was removed`);
  }
}
```

Place it where `fm.type`/`fm.actions` are already validated (around `tools.ts:43`).

- [ ] **Step 4: Rebuild the argv in `src/sandboxRun.ts`**

Replace the `const command = resolveTemplate(...)` line (25) and the `command: command.split(/\s+/)` usage (42) with:

```ts
const ctx = { params, conn };
const binTokens = (m.bin ? m.bin.trim().split(/\s+/) : []).map((t) => resolveTemplate(t, ctx));
const argv = [...binTokens, ...action.command.map((t) => resolveTemplate(t, ctx))];
```

…and pass `command: argv` to `runArgs`. The `env` line that also calls `resolveTemplate` with `{ params, conn }` can reuse `ctx`. Keep the existing `if (!action?.command)` guard.

- [ ] **Step 5: Migrate every string `command:` fixture to array form**

- `test/invoke.test.ts:33` → `command: ["go"]`
- `test/tools.test.ts:48` → `command: ["send", "--to", "${params.to}"]`
- `test/tools.test.ts:116` → `command: ["fetch", "--url", "${params.url}"]`
- `test/sandboxRun.test.ts:19` → `command: ["fetch", "--url", "${params.url}"]`
- `test/docker.test.ts:10` → `command: ["fetch", "--url", "x"]`
- `test/installer.test.ts:17` → `command: ["fetch"]`
- `test/integration/fixture-tool/tools/echo-tool/TOOL.md` (3 actions): `["--url", "${params.url}"]`, `["--token"]`, `["--net-check"]`

(These are YAML strings inside template literals in the .ts tests — keep them valid YAML flow sequences.)

- [ ] **Step 6: Update `kernel-skills/onboard-tool.md`**

In the worked example, change `command: "fetch --url ${params.url}"` to `command: ["fetch", "--url", "${params.url}"]`, and add under the `actions` bullet (line ~21) the note: *command is an argv array — one token per element, never a single shell string; put an interpolated value like `${params.url}` in its own element.*

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: all green (185 prior + new). If a migrated fixture still reads as a string somewhere, fix that fixture (not the validator).

- [ ] **Step 8: Typecheck + lint gate**

Run: `npx tsc --noEmit && npx eslint src test`
Expected: clean (the husky pre-commit gate runs these; new/changed exports keep their JSDoc).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(#3): argv-array cli action form; drop whitespace command split"
```

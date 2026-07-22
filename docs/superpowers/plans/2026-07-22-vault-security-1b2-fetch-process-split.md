# Vault Security 1B-2: Fetch/Process Egress Split (Layer 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close hole C (agent egress) by splitting external fetching from vault processing into two agent roles with opposite privileges — a **fetcher** (broad network, no vault, distinct third uid) that distills external material to a staging dir, and a **librarian** (vault write, model-host-only egress, WebFetch/WebSearch denied) that authors the vault from that staging only.

**Architecture:** Roles already drive the prompt fragment (`src/constitution.ts`); Layer 2 makes them drive the sandbox too. Per-role egress needs two controls: `allowedDomains` (Bash egress, Linux) AND a new `allowWebTools` flag on `SandboxSettings` that crosses the pipe and gates WebFetch/WebSearch in `buildPermissionHandler`. The fetcher runs under a distinct `geode-fetcher` uid not in the vault's `geode-rw` group, so a `2770` vault denies it. `query()` orchestrates fetcher→librarian in one `runManager.run` closure, creating/cleaning a per-run staging dir; git is untouched because the fetcher writes outside the vault.

**Tech Stack:** Node 20, TypeScript ESM run via tsx, Vitest, Docker for the adversarial check.

**Scope:** Slice 1B-2 = Layer 2 (spec `docs/superpowers/specs/2026-07-20-vault-security-foundation-design.md` §2 Layer 2 + §6.3 + §6.6). Completes Layers 1+2. Does NOT touch multi-vault hosting (slice 2). On non-root dev, per-uid + per-host-Bash-egress isolation is a same-uid/unenforced fallback (like 1B-1b); the real boundary is a privileged-Linux property proven by the Docker harness.

## Global Constraints

- **English-only** in code/comments. **New exports need JSDoc** (husky gate). **Surgical** changes; match existing style.
- **The two librarian egress controls ship together.** `allowedDomains=[llmHost]` alone is insufficient — WebFetch/WebSearch are host-process tools bounded only by `canUseTool`. The librarian must be `allowWebTools:false` AND `allowedDomains:[llmHost]`.
- **The fetcher never writes or reads the vault.** Its write root is the staging dir; its uid is `geode-fetcher` (not in `geode-rw`); it processes hostile input, so this is load-bearing.
- **The two-step orchestration lives in `query()`, in one `runManager.run` closure.** Git (`commitAll`/`resetToHead`/`changedFilesSince`) must remain untouched — it only sees librarian vault writes.
- **The trigger is explicit** (a flag on the ingest path), never inferred from instruction text. Plain desk/`remember` runs stay single-call.
- Run `npm run typecheck` and `npm test` green before every commit.

## Seams (from the 1B-2 de-risk — all file:line verified)

- `src/constitution.ts` — `AgentRole` (`:27`), `DESK_FRAGMENT` (`:30-34`), `LIBRARIAN_FRAGMENT` (`:37-41`), `fragmentFor` (`:44-46`).
- `src/agentSandbox.ts` — `SandboxPolicy`/`SandboxSettings` interfaces, `resolveSandboxPolicy` (`:61-74`, unions domains at `:66`), `buildSandboxSettings` (`:77-92`, `allowRead` at `:85-87`), `buildPermissionHandler` (`:134-173`, web deny lifted at `:141-143`).
- `src/engine.ts` — `EngineRunOptions` (`:26-33`), `canUseTool: buildPermissionHandler(opts.sandbox.filesystem.allowWrite)` (`~:189`).
- `src/query.ts` — run closure (`:90-164`), role selection (`:106`), engine call (`:118-125`), commit block (`:129-163`).
- `src/ingest.ts` — `remember` hardcodes `role:"librarian"` (`:33`).
- `src/index.ts` — `createSubprocessEngine` built once (`:81-87`); `provisionRunner` (`src/runner/provision.ts`).
- `src/config.ts` — add `fetcherUid?`/`fetcherGid?`.

## File Structure

**Modified:** `src/agentSandbox.ts`, `src/engine.ts`, `src/constitution.ts`, `src/config.ts`, `src/runner/provision.ts`, `src/query.ts`, `src/index.ts`, `src/ingest.ts`, `scripts/verify-uid-boundary.ts`, `Dockerfile`.
**Created:** tests alongside each; a per-run staging helper if `query.ts` grows unwieldy.

---

## Task 1: `allowWebTools` gate in the permission handler

**Files:** Modify `src/agentSandbox.ts` (`SandboxSettings` + `buildPermissionHandler`), `src/engine.ts` (pass it through); Test `test/agentSandbox.test.ts` (extend).

**Interfaces:**
- `SandboxSettings` gains `network: { allowedDomains: string[]; allowLocalBinding?: boolean; allowWebTools?: boolean }` (add `allowWebTools`).
- `buildPermissionHandler(writeRoots: string[], allowWebTools: boolean)` — when `allowWebTools === false`, DENY `WebFetch` and `WebSearch`; when true, allow (current behavior).

- [ ] **Step 1: Write the failing test**

```ts
// test/agentSandbox.test.ts (add)
import { buildPermissionHandler } from "../src/agentSandbox.js";
describe("allowWebTools gate", () => {
  it("denies WebFetch/WebSearch when allowWebTools is false", async () => {
    const h = buildPermissionHandler(["/v"], false);
    expect((await h("WebFetch", { url: "https://x" })).behavior).toBe("deny");
    expect((await h("WebSearch", { query: "x" })).behavior).toBe("deny");
  });
  it("allows WebFetch/WebSearch when allowWebTools is true", async () => {
    const h = buildPermissionHandler(["/v"], true);
    expect((await h("WebFetch", { url: "https://x" })).behavior).toBe("allow");
    expect((await h("WebSearch", { query: "x" })).behavior).toBe("allow");
  });
});
```

- [ ] **Step 2: Run** → FAIL (arity/behavior).

- [ ] **Step 3: Implement.** In `src/agentSandbox.ts`: add `allowWebTools?: boolean` to `SandboxSettings.network`. Change `buildPermissionHandler(writeRoots: string[], allowWebTools: boolean)`; near the top of the returned handler (after the `dangerouslyDisableSandbox` deny), add:

```ts
    if (!allowWebTools && (toolName === "WebFetch" || toolName === "WebSearch")) {
      return deny(`${toolName} is disabled for this role (network is restricted to the model host)`);
    }
```

In `src/engine.ts` (`~:189`), change the call to `buildPermissionHandler(opts.sandbox.filesystem.allowWrite, opts.sandbox.network.allowWebTools ?? true)` (default true preserves existing callers/tests). Also ensure `buildSandboxSettings` sets `allowWebTools` on `network` (Task 2 will vary it; default it to `true` here so nothing breaks).

- [ ] **Step 4: Run** the new test + full suite `npx vitest run`. Fix any existing `buildPermissionHandler(x)` caller (add the second arg `true`).

- [ ] **Step 5: Commit** — `feat(sandbox): allowWebTools flag gates WebFetch/WebSearch per role`

---

## Task 2: Per-role `allowedDomains` in `buildSandboxSettings`

**Files:** Modify `src/agentSandbox.ts` (`SandboxPolicy`, `resolveSandboxPolicy`, `buildSandboxSettings`); Test `test/agentSandbox.test.ts`.

**Interfaces:**
- Split the policy's domains: `SandboxPolicy` gains `llmHost: string` and `onboardingDomains: string[]` (keep `allowedDomains` computed or remove it — see below).
- `buildSandboxSettings(policy, extraReadDirs, opts?: { role?: "fetcher" | "librarian" | "desk" })` — assembles `allowedDomains`:
  - librarian/desk → `[policy.llmHost]`
  - fetcher → `[policy.llmHost, ...policy.onboardingDomains]`
  - and sets `allowWebTools`: fetcher → `true`, librarian → `false`, desk → keep current behavior (see Task 6 note — desk keeps today's open web tools unless we tighten it; default desk to `true` to avoid regressing existing desk Q&A that may WebSearch).

- [ ] **Step 1: Write the failing test** asserting: `buildSandboxSettings(policy, [], {role:"librarian"})` → `network.allowedDomains === [llmHost]` and `allowWebTools === false`; `{role:"fetcher"}` → domains include the onboarding hosts and `allowWebTools === true`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** In `resolveSandboxPolicy` keep `llmHost` and `onboardingDomains = DEFAULT_ONBOARDING_DOMAINS + GEODE_AGENT_ALLOWED_DOMAINS` separate on the policy. In `buildSandboxSettings`, compute `allowedDomains` + `allowWebTools` from the `role`. Preserve `allowLocalBinding` logic.

- [ ] **Step 4: Run** new test + full suite (fix any `buildSandboxSettings` caller for the new optional arg — it's optional, so existing calls default to librarian/desk behavior; confirm `query.ts:124`'s current call still typechecks).

- [ ] **Step 5: Commit** — `feat(sandbox): per-role allowedDomains + allowWebTools (librarian=llm-only, fetcher=broad)`

---

## Task 3: `fetcher` role + fragment

**Files:** Modify `src/constitution.ts` (`AgentRole`, add `FETCHER_FRAGMENT`, `fragmentFor`); Test `test/constitution.test.ts` (or wherever `fragmentFor` is tested).

**Interfaces:** `AgentRole = "desk" | "librarian" | "fetcher"`. `FETCHER_FRAGMENT` per §6.3: the fetcher fetches the external URL/repo and writes a **structured distillate to the staging dir** — (a) API facts (base URLs, auth scheme, endpoints/fields), (b) the source hosts it drew from, (c) load-bearing verbatim excerpts **marked as untrusted quoted material**; it MUST NOT write the vault and never authors `TOOL.md` (the librarian does that from the distillate).

- [ ] **Step 1: Write the failing test** — `fragmentFor("fetcher")` returns the fetcher fragment (contains a distinctive phrase like "distill" / "staging").
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add the union member, the fragment constant (English, following the DESK/LIBRARIAN fragment style/length), and the `fragmentFor` branch.
- [ ] **Step 4: Run** new test + full suite.
- [ ] **Step 5: Commit** — `feat(roles): fetcher role + fragment (distill external input to staging)`

---

## Task 4: Config for the fetcher account

**Files:** Modify `src/config.ts`; Test `test/runnerConfig.test.ts`.

**Interfaces:** `Config` gains `fetcherUid?: number` (`GEODE_FETCHER_UID`), `fetcherGid?: number` (`GEODE_FETCHER_GID`) — the distinct third principal, NOT in `geode-rw`.

- [ ] Mirror Task-1-of-1B-1b exactly (same `env.X ? Number(env.X) : undefined` guard). Test: parses numbers; undefined when unset. Commit `feat(config): fetcher uid/gid`.

---

## Task 5: Per-role runner spawn (fetcher uid vs librarian uid)

**Files:** Modify `src/runner/provision.ts` (a role-parameterized provisioning), `src/index.ts` (build a per-role engine or a role-param spawn), `src/engine.ts`/`src/subprocessEngine.ts` if the `Engine` signature must carry role; Test `test/runner/provision.test.ts`.

**Design decision (pick the lower-churn seam):** the cleanest is to make the **broker hold TWO `Engine`s** — a librarian engine (spawn uid = `runnerUid`) and a fetcher engine (spawn uid = `fetcherUid`) — both built from `provisionRunner` with a role arg that selects the uid/gid + the fetcher's staging as its HOME-adjacent tmp. `query()` picks the engine by role. This keeps `subprocessEngine`/the pipe unchanged (the `Engine` type stays `(opts)=>AsyncIterable`).

**Interfaces:** `provisionRunner(config, deps, role: "librarian" | "fetcher")` selects `{uid,gid}` from `runnerUid/Gid` vs `fetcherUid/Gid` (via a role→config map), same env allowlist + same-uid fallback. `index.ts` builds `engineFor = { librarian: createSubprocessEngine(...libSpawn), fetcher: createSubprocessEngine(...fetchSpawn) }` and passes both into `queryDeps` (e.g. `deps.engineFor(role)` replacing the single `deps.engine`).

- [ ] **Step 1: Write the failing test** — `provisionRunner(cfg, deps, "fetcher")` returns `uid === cfg.fetcherUid` when root+configured; `"librarian"` returns `runnerUid`; both fall back to same-uid off-root.
- [ ] **Step 2-4:** implement `provisionRunner`'s role arg; refactor `index.ts` to build the two engines and expose `engineFor(role)` on `queryDeps` (update the `QueryDeps` type + the `query.ts` call site to use `deps.engineFor(role)` instead of `deps.engine`). Keep the existing single-call desk/librarian path working (it just calls `engineFor(role)`). Full suite green — the `query.ts` tests inject a fake engine; update the injection to `engineFor: () => fakeEngine` (a small test-shim change).
- [ ] **Step 5: Commit** — `feat(runner): per-role spawn (fetcher uid distinct from librarian uid)`

**Note:** this task changes `QueryDeps.engine` → `engineFor(role)`. Every `query.ts` test and the MCP/dashboard wiring that supplies `engine` must switch to `engineFor`. Grep `engine:` in `test/` and `src/` and update each. This is the largest mechanical surface of the slice.

---

## Task 6: Two-step orchestration + staging lifecycle in `query()`

**Files:** Modify `src/query.ts` (the run closure), `src/ingest.ts` (the trigger flag); Test `test/query.test.ts` (extend).

**Interfaces:** `query(..., opts)` gains `opts.fetch?: boolean` (or `opts.sourceUrl?: string`). When set, inside the SAME `runManager.run` closure:
1. Create a per-run staging dir (e.g. under `~/.geode/fetch-staging/<runId>`), owned/writable by the fetcher uid (or same-uid on dev).
2. **Fetcher call:** `engineFor("fetcher")({ instruction: <fetch instruction>, cwd: stagingDir, systemPrompt: composeSystemPrompt(deps, "fetcher"), sandbox: buildSandboxSettings(policy, [], {role:"fetcher"}) , abortController })`. Its write root is the staging dir; no vault.
3. **Abort check:** if `abortController.signal.aborted`, `rm -rf` staging and return/throw — do NOT run the librarian.
4. **Librarian call:** `engineFor("librarian")({ instruction: <original>, cwd: vaultRoot, systemPrompt: composeSystemPrompt(deps,"librarian"), sandbox: buildSandboxSettings(policy, [stagingDir], {role:"librarian"}), abortController })` — staging is `extraReadDirs` (read-only), egress model-host-only, WebFetch/WebSearch denied.
5. The existing commit/rebuild block (`:129-163`) runs on the librarian's vault writes, unchanged.
6. **`finally`: `rm -rf` the staging dir on every path** (success, error, abort).

When `opts.fetch` is falsy, behavior is exactly today's single `engineFor(role)` call — no fetcher, no staging (zero regression / no latency tax).

`src/ingest.ts`: the URL/source ingest path sets `fetch: true` (mirroring how it already sets `role:"librarian"` at `:33`). Plain `remember` without a source stays single-call.

- [ ] **Step 1: READ `src/query.ts` fully first** (the run closure, retrieval, engine call, commit block, error/abort path) — you must understand the exact lifecycle before editing. Then write the failing test: with a fake `engineFor` recording calls, a `query({fetch:true})` invokes the fetcher engine then the librarian engine in order, the staging dir exists during the run and is gone after, and git commit still fires on the librarian's writes. Add an abort-mid-fetch test: the librarian engine is NOT called and staging is cleaned.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the orchestration + staging create/cleanup + abort check, gated on `opts.fetch`.
- [ ] **Step 4: Run** new tests + full suite. Confirm the single-call path is untouched (existing query tests still pass).
- [ ] **Step 5: Live check (controller-run, non-root dev):** the controller will drive a real fetch→process run (same-uid, but proves the two-step orchestration + staging + prompts work end-to-end with the real SDK). Leave a note in the report requesting it.
- [ ] **Step 6: Commit** — `feat(query): fetcher->librarian two-step with per-run staging (opt-in)`

---

## Task 7: Docker harness — fetcher cannot read the vault

**Files:** Modify `scripts/verify-uid-boundary.ts` + `Dockerfile` + `.agent/SOP/verify-uid-boundary.md`.

Extend the existing adversarial harness (which already proves the runner/librarian uid gets EACCES on secrets but can write the vault). Add a `geode-fetcher` user NOT in `geode-rw`, and assert: a probe spawned as `{uid: FETCHER_UID, gid: FETCHER_GID}` gets **EACCES reading a vault file** (the `2770` vault denies "other"), gets EACCES on `secrets.enc`, but **can write its staging dir**. This proves the fetcher is vault-blind on a privileged host.

- [ ] **Step 1:** add the fetcher user (not in geode-rw) to the `Dockerfile`; add the fetcher-probe assertions to `verify-uid-boundary.ts` (vault-read → EACCES; secrets-read → EACCES; staging-write → success).
- [ ] **Step 2: Build + run** `docker build -t geode-uidcheck . && docker run --rm geode-uidcheck`; iterate until it passes and records the fetcher-vault-blind proof. Capture the real output.
- [ ] **Step 3:** update the SOP with the fetcher ownership model (geode-fetcher uid/gid, NOT in geode-rw; GEODE_FETCHER_UID/GID both required).
- [ ] **Step 4: Commit** — `test(security): harness proves the fetcher uid is vault-blind`

---

## Final verification

- [ ] `npm run typecheck`, `npx vitest run`, `npm run lint` — all green.
- [ ] Task 6 live check recorded (a real fetch→process run works end-to-end on dev, same-uid).
- [ ] Task 7 recorded: Docker harness proves the fetcher uid gets EACCES on the vault AND secrets, can write staging; the librarian uid EACCES on secrets, can write+commit vault.
- [ ] Update `.agent/System/security-model.md` + `architecture.md`: Layer 2 is live — fetcher (broad net, no vault, distinct uid) / librarian (vault, model-host-only via allowedDomains + allowWebTools deny); two-step orchestration in query(); hole C closed **on a privileged host** (same-uid/Linux caveat as 1B-1b). Note per-host Bash egress is Linux-only.
- [ ] Update `security-model.md`'s "Stale published claim" about WebFetch/WebSearch — it is now denied for the librarian (and gated per role), no longer open for every role.

## After this slice

Layers 1+2 are complete. Holes A/B/C/D/E/F/G are closed on a privileged Linux host. The vault is ready to hold real client secrets there. Next major work is **slice 2** (multi-vault hosting: supervisor + subdomain routing + vault-CRUD + the header switcher). The 1B-1b deploy residual (pre-create `runnerHome`/`tmp` + now `geode-fetcher` account, ownership modes) folds into slice 2's deploy provisioning.

# Agent-core Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confine the vault curation agent with the Agent SDK's native OS sandbox — write-limited to the vault, egress limited to an explicit allowlist — without breaking non-interactive runs, tools, or local-model support.

**Architecture:** A new pure module `src/agentSandbox.ts` resolves a sandbox *policy* from env + the vault root and builds the SDK's `sandbox` settings object. The policy threads `index.ts` → `QueryDeps` → `query()` → the engine call → `buildQueryOptions` → the Agent SDK. The OS boundary (bubblewrap on Linux, seatbelt on macOS) is enforced by the SDK; we only configure it.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk` v0.3.179, Vitest.

## Global Constraints

- SDK: `@anthropic-ai/claude-agent-sdk` **v0.3.179** — use its native `sandbox` option (no custom container).
- Filesystem: `allowWrite` = **[vault root] only**; reads stay permissive (write is the hard boundary).
- Network: **default-deny egress**; explicit allowlist = the LLM host (`ANTHROPIC_BASE_URL` host, else `api.anthropic.com`) + git/package hosts. **Do NOT use `allowManagedDomainsOnly`** (breaks loopback + onboarding).
- Non-interactive preserved: keep `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true`; layer the sandbox on top (OS boundary is authoritative).
- Fail-closed: `failIfUnavailable: true`; dev override `GEODE_SANDBOX_DISABLE=1` disables the sandbox (loud, off by default).
- Local model: reached via `ANTHROPIC_BASE_URL` pointing at an Anthropic-compatible gateway; a loopback host also sets `allowLocalBinding: true`.
- Deploy (Linux): image must ship **bubblewrap + socat**; macOS uses built-in seatbelt.
- Quality gate: husky `lint-staged` runs `eslint --fix` (JSDoc required on every top-level function/interface/type) + `npm run typecheck` on staged `src/**/*.ts`. **Every commit must pass** — write a real JSDoc block on each new top-level symbol.
- Commit trailer: end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `src/agentSandbox.ts` — pure: `SandboxPolicy`/`SandboxSettings` types, `resolveSandboxPolicy`, `buildSandboxSettings`, `hostFromUrl`. One responsibility: env/config → SDK sandbox settings.
- **Create** `test/agentSandbox.test.ts` — unit tests for the above.
- **Modify** `src/engine.ts` — add `sandbox?: SandboxSettings` to `EngineRunOptions`; forward it in `buildQueryOptions`.
- **Modify** `test/engine.test.ts` — assert `buildQueryOptions` forwards / omits `sandbox`.
- **Modify** `src/query.ts` — add `sandboxPolicy?: SandboxPolicy` to `QueryDeps`; pass `sandbox: buildSandboxSettings(deps.sandboxPolicy)` to the engine.
- **Modify** `test/query.test.ts` — assert the engine receives sandbox settings from the policy (and none when absent).
- **Modify** `src/index.ts` — resolve the policy at startup into `queryDeps`.
- **Modify** `docs/` / env docs + deploy — new env vars + bubblewrap/socat requirement + manual confinement verification.

---

### Task 1: Sandbox policy + settings (pure module)

**Files:**
- Create: `src/agentSandbox.ts`
- Test: `test/agentSandbox.test.ts`

**Interfaces:**
- Produces:
  - `interface SandboxPolicy { enabled: boolean; failIfUnavailable: boolean; allowWrite: string[]; allowedDomains: string[]; allowLocalBinding: boolean }`
  - `interface SandboxSettings { enabled: boolean; failIfUnavailable: boolean; autoAllowBashIfSandboxed: boolean; filesystem: { allowWrite: string[]; allowRead?: string[] }; network: { allowedDomains: string[]; allowLocalBinding?: boolean } }`
  - `resolveSandboxPolicy(env: Record<string, string | undefined>, vaultRoot: string): SandboxPolicy`
  - `buildSandboxSettings(policy: SandboxPolicy | undefined, extraReadDirs?: string[]): SandboxSettings | undefined`
  - `hostFromUrl(url: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `test/agentSandbox.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSandboxPolicy, buildSandboxSettings, hostFromUrl } from "../src/agentSandbox.js";

describe("resolveSandboxPolicy", () => {
  it("confines writes to the vault and is fail-closed by default", () => {
    const p = resolveSandboxPolicy({}, "/vault");
    expect(p.enabled).toBe(true);
    expect(p.failIfUnavailable).toBe(true);
    expect(p.allowWrite).toEqual(["/vault"]);
  });
  it("allowlists the default Anthropic host + onboarding hosts, no loopback", () => {
    const p = resolveSandboxPolicy({}, "/vault");
    expect(p.allowedDomains).toContain("api.anthropic.com");
    expect(p.allowedDomains).toContain("github.com");
    expect(p.allowLocalBinding).toBe(false);
  });
  it("uses ANTHROPIC_BASE_URL host and enables loopback for a local model", () => {
    const p = resolveSandboxPolicy({ ANTHROPIC_BASE_URL: "http://localhost:11434" }, "/vault");
    expect(p.allowedDomains).toContain("localhost");
    expect(p.allowedDomains).not.toContain("api.anthropic.com");
    expect(p.allowLocalBinding).toBe(true);
  });
  it("merges GEODE_AGENT_ALLOWED_DOMAINS", () => {
    const p = resolveSandboxPolicy({ GEODE_AGENT_ALLOWED_DOMAINS: "example.com, foo.dev" }, "/vault");
    expect(p.allowedDomains).toEqual(expect.arrayContaining(["example.com", "foo.dev"]));
  });
  it("disables when GEODE_SANDBOX_DISABLE=1", () => {
    expect(resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/vault").enabled).toBe(false);
  });
});

describe("buildSandboxSettings", () => {
  it("returns undefined when disabled or absent", () => {
    expect(buildSandboxSettings(resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/v"))).toBeUndefined();
    expect(buildSandboxSettings(undefined)).toBeUndefined();
  });
  it("builds SDK settings with auto-allow bash and the write scope", () => {
    const s = buildSandboxSettings(resolveSandboxPolicy({}, "/vault"))!;
    expect(s.enabled).toBe(true);
    expect(s.autoAllowBashIfSandboxed).toBe(true);
    expect(s.filesystem.allowWrite).toEqual(["/vault"]);
    expect(s.network.allowedDomains).toContain("api.anthropic.com");
    expect(s.filesystem.allowRead).toBeUndefined();
  });
  it("adds per-run read dirs (attachment hook)", () => {
    const s = buildSandboxSettings(resolveSandboxPolicy({}, "/vault"), ["/tmp/att"])!;
    expect(s.filesystem.allowRead).toEqual(["/tmp/att"]);
  });
});

describe("hostFromUrl", () => {
  it("extracts host or returns null", () => {
    expect(hostFromUrl("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
    expect(hostFromUrl("not a url")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/agentSandbox.test.ts`
Expected: FAIL — `Cannot find module '../src/agentSandbox.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/agentSandbox.ts`:

```ts
/** Resolved OS-sandbox policy for the vault agent, derived once from env + the vault root. */
export interface SandboxPolicy {
  enabled: boolean;
  failIfUnavailable: boolean;
  allowWrite: string[];
  allowedDomains: string[];
  allowLocalBinding: boolean;
}

/** The subset of the Agent SDK's SandboxSettings we construct (structural; flows into the untyped SDK options). */
export interface SandboxSettings {
  enabled: boolean;
  failIfUnavailable: boolean;
  autoAllowBashIfSandboxed: boolean;
  filesystem: { allowWrite: string[]; allowRead?: string[] };
  network: { allowedDomains: string[]; allowLocalBinding?: boolean };
}

// Hosts the agent legitimately reaches while onboarding a tool (repo clone / package fetch).
const DEFAULT_ONBOARDING_DOMAINS = [
  "github.com", "raw.githubusercontent.com", "codeload.github.com",
  "objects.githubusercontent.com", "registry.npmjs.org",
  "pypi.org", "files.pythonhosted.org",
];

// The Anthropic API host used when no ANTHROPIC_BASE_URL override is set.
const DEFAULT_LLM_HOST = "api.anthropic.com";

/** Extracts the hostname from a URL, or null when it cannot be parsed. */
export function hostFromUrl(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/** True for loopback hosts — i.e. a local model gateway on this machine. */
function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
}

/** Resolves the sandbox policy from env + the vault root. Fail-closed unless GEODE_SANDBOX_DISABLE is set. */
export function resolveSandboxPolicy(env: Record<string, string | undefined>, vaultRoot: string): SandboxPolicy {
  const disabled = env.GEODE_SANDBOX_DISABLE === "1" || env.GEODE_SANDBOX_DISABLE === "true";
  const base = env.ANTHROPIC_BASE_URL ? hostFromUrl(env.ANTHROPIC_BASE_URL) : null;
  const llmHost = base ?? DEFAULT_LLM_HOST;
  const extra = (env.GEODE_AGENT_ALLOWED_DOMAINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowedDomains = Array.from(new Set([llmHost, ...DEFAULT_ONBOARDING_DOMAINS, ...extra]));
  return {
    enabled: !disabled,
    failIfUnavailable: true,
    allowWrite: [vaultRoot],
    allowedDomains,
    allowLocalBinding: isLoopback(llmHost),
  };
}

/** Builds the Agent SDK `sandbox` settings from the policy; undefined when disabled. `extraReadDirs` grants per-run read access (e.g. attachment staging). */
export function buildSandboxSettings(policy: SandboxPolicy | undefined, extraReadDirs: string[] = []): SandboxSettings | undefined {
  if (!policy || !policy.enabled) return undefined;
  return {
    enabled: true,
    failIfUnavailable: policy.failIfUnavailable,
    autoAllowBashIfSandboxed: true,
    filesystem: extraReadDirs.length
      ? { allowWrite: policy.allowWrite, allowRead: extraReadDirs }
      : { allowWrite: policy.allowWrite },
    network: policy.allowLocalBinding
      ? { allowedDomains: policy.allowedDomains, allowLocalBinding: true }
      : { allowedDomains: policy.allowedDomains },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/agentSandbox.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/agentSandbox.ts test/agentSandbox.test.ts
git commit -m "feat(sandbox): resolve agent sandbox policy + SDK settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Forward the sandbox through the engine

**Files:**
- Modify: `src/engine.ts` (`EngineRunOptions` ~lines 23-30; `buildQueryOptions` ~lines 159-174)
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `SandboxSettings` from Task 1.
- Produces: `EngineRunOptions.sandbox?: SandboxSettings`; `buildQueryOptions` output carries a `sandbox` key when provided.

- [ ] **Step 1: Write the failing tests** — add to `test/engine.test.ts`:

```ts
import { buildQueryOptions } from "../src/engine.js";

test("buildQueryOptions forwards sandbox settings when provided", () => {
  const opts = buildQueryOptions({
    instruction: "hi", cwd: "/vault", systemPrompt: "SYS", abortController: new AbortController(),
    sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true,
      filesystem: { allowWrite: ["/vault"] }, network: { allowedDomains: ["api.anthropic.com"] } },
  });
  expect(opts.sandbox).toMatchObject({ enabled: true, filesystem: { allowWrite: ["/vault"] } });
  // non-interactive behaviour is retained alongside the sandbox
  expect(opts.permissionMode).toBe("bypassPermissions");
});

test("buildQueryOptions omits sandbox when not provided", () => {
  const opts = buildQueryOptions({ instruction: "hi", cwd: "/vault", systemPrompt: "SYS", abortController: new AbortController() });
  expect(opts.sandbox).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/engine.test.ts`
Expected: FAIL — `sandbox` is not a known property of `EngineRunOptions` (type error) / `opts.sandbox` is undefined in the first test.

- [ ] **Step 3: Implement — add the import + option + forward**

In `src/engine.ts`, add the type import near the top (after the existing imports, before the interfaces):

```ts
import type { SandboxSettings } from "./agentSandbox.js";
```

Add the field to `EngineRunOptions` (the interface at ~line 24):

```ts
export interface EngineRunOptions {
  instruction: string;
  cwd: string;
  systemPrompt: string;
  model?: string;
  abortController: AbortController;
  sandbox?: SandboxSettings;
}
```

In `buildQueryOptions` (~line 160), forward it by adding this line inside the returned object, right after the `...(opts.model ? { model: opts.model } : {})` spread:

```ts
    ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine.ts test/engine.test.ts
git commit -m "feat(sandbox): forward sandbox settings through the engine options

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Thread the policy from startup into the run

**Files:**
- Modify: `src/query.ts` (`QueryDeps` ~lines 11-20; engine call ~lines 70-76)
- Modify: `src/index.ts` (`queryDeps` ~lines 52-61)
- Test: `test/query.test.ts`

**Interfaces:**
- Consumes: `SandboxPolicy`, `buildSandboxSettings`, `resolveSandboxPolicy` from Task 1.
- Produces: `QueryDeps.sandboxPolicy?: SandboxPolicy`; the engine call receives `sandbox: buildSandboxSettings(deps.sandboxPolicy)`.

- [ ] **Step 1: Write the failing tests** — add to `test/query.test.ts`:

```ts
import { resolveSandboxPolicy } from "../src/agentSandbox.js";

test("engine receives sandbox settings built from the sandbox policy", async () => {
  let seen: any;
  const engine = async function* (opts: any) { seen = opts.sandbox; yield { type: "result", text: "ok" }; };
  const d = deps({ engine: engine as any, sandboxPolicy: resolveSandboxPolicy({}, "/vault") } as any);
  await query(d, "hi");
  expect(seen).toBeDefined();
  expect(seen.filesystem.allowWrite).toEqual(["/vault"]);
  expect(seen.network.allowedDomains).toContain("api.anthropic.com");
});

test("engine receives no sandbox when the policy is absent", async () => {
  let seen: any = "unset";
  const engine = async function* (opts: any) { seen = opts.sandbox; yield { type: "result", text: "ok" }; };
  const d = deps({ engine: engine as any });
  await query(d, "hi");
  expect(seen).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/query.test.ts`
Expected: FAIL — first test: `opts.sandbox` is undefined (query does not pass it yet).

- [ ] **Step 3: Implement — `src/query.ts`**

Add the import (near the existing `buildOverlay` import):

```ts
import { buildSandboxSettings, type SandboxPolicy } from "./agentSandbox.js";
```

Add the field to the `QueryDeps` interface (after `systemPrompt: string;`):

```ts
  sandboxPolicy?: SandboxPolicy;
```

In the `deps.engine({ ... })` call (~line 70), add the `sandbox` line right after `abortController,`:

```ts
        abortController,
        sandbox: buildSandboxSettings(deps.sandboxPolicy),
```

- [ ] **Step 4: Implement — `src/index.ts`**

Add the import (near the `claudeAgentEngine` import at the top):

```ts
import { resolveSandboxPolicy } from "./agentSandbox.js";
```

In the `queryDeps` object literal (~line 52), add this line after `systemPrompt: CONSTITUTION,`:

```ts
    sandboxPolicy: resolveSandboxPolicy(process.env, config.workspaceRoot),
```

- [ ] **Step 5: Run to verify pass (whole suite — nothing regressed)**

Run: `npx vitest run`
Expected: PASS — the two new query tests pass and every existing test is still green.

- [ ] **Step 6: Commit**

```bash
git add src/query.ts src/index.ts test/query.test.ts
git commit -m "feat(sandbox): enable the agent sandbox for every run at startup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Env docs, deploy deps, and confinement verification

**Files:**
- Modify: `README.md` (or the env/config section) + the deploy manifest (Dockerfile / Fly config) if present
- Verify: manual procedure (OS confinement is enforced by the SDK/OS; the automated tests cover the config logic)

- [ ] **Step 1: Document the new env vars**

Add to the README env section:

```markdown
- `GEODE_AGENT_ALLOWED_DOMAINS` — comma-separated extra domains the sandboxed agent may reach
  (on top of the LLM host + git/package hosts). Default: none.
- `ANTHROPIC_BASE_URL` — override the LLM endpoint (e.g. a local Anthropic-compatible gateway).
  Its host (loopback included) is auto-added to the network allowlist — this is how a local
  model is used.
- `GEODE_SANDBOX_DISABLE=1` — dev-only escape hatch that runs the agent UNsandboxed. Off by
  default; never set in production.
```

- [ ] **Step 2: Ensure the Linux runtime ships the sandbox deps**

In the deploy image (Dockerfile / Fly build), install `bubblewrap` and `socat`. Example apt line:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap socat && rm -rf /var/lib/apt/lists/*
```

(macOS dev needs nothing extra — seatbelt is built in.)

- [ ] **Step 3: Commit the docs/deploy change**

```bash
git add README.md
git commit -m "docs(sandbox): document sandbox env vars + Linux bwrap/socat deploy dep

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual confinement verification (run locally with a real API key)**

Rebuild + restart the kernel (`npx tsx --env-file=.env src/index.ts`), open the dashboard, and in the vault chat run each check:

1. **Write is confined:** "Create a file at `/tmp/geode-escape.txt` with the text hi." → the run must fail / be unable to create it. Confirm `/tmp/geode-escape.txt` does NOT exist on the host.
2. **Egress is confined:** "Use bash to curl https://example.com and show the response." → must fail (not on the allowlist).
3. **Normal run works:** "Add a note `notes/sandbox-check.md` saying hello." → succeeds, file appears under the vault, no permission prompt.
4. **Dev override:** set `GEODE_SANDBOX_DISABLE=1`, restart, repeat check 1 → the file IS created (sandbox off). Unset again afterwards.

**Contingency:** if check 1 or 2 still succeeds with the sandbox enabled, `bypassPermissions` is overriding the sandbox. Fix: in `buildQueryOptions`, when `opts.sandbox` is present, drop `allowDangerouslySkipPermissions`/`permissionMode: "bypassPermissions"` and instead rely on `autoAllowBashIfSandboxed` plus a permissive `canUseTool` that returns `{ behavior: "allow" }` for every tool (keeps runs non-interactive while letting the sandbox enforce). Re-run checks 1-3.

- [ ] **Step 5: Record the verification outcome**

Append a short note to the spec's follow-ups (or a `VERIFIED:` line) with the date and which permission-mode combination was confirmed to actually confine, then commit:

```bash
git add docs/superpowers/specs/2026-07-01-agent-sandbox-design.md
git commit -m "docs(sandbox): record confinement verification outcome

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Native SDK sandbox → Task 1 (`buildSandboxSettings`) + Task 2 (forwarding) + Task 3 (enablement). ✓
- Filesystem write=vault, read permissive → Task 1 `allowWrite: [vaultRoot]`, no `denyRead`. ✓
- Network allowlist (LLM host + git/package), reject managed-only, local-model loopback → Task 1. ✓
- Non-interactive preserved (keep bypassPermissions) → Task 2 test asserts `permissionMode`. ✓
- Fail-closed + dev override → Task 1 (`failIfUnavailable: true`, `GEODE_SANDBOX_DISABLE`). ✓
- Deploy bubblewrap+socat → Task 4 Step 2. ✓
- Confinement holds (integration) → Task 4 Step 4 manual verification + contingency. ✓
- D12 attachment hook → Task 1 `extraReadDirs` param + test. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the one "decide at impl" from the spec (permission-mode combo) is resolved to a concrete default (keep bypass) with an explicit, coded contingency. ✓

**Type consistency:** `SandboxPolicy` / `SandboxSettings` / `resolveSandboxPolicy` / `buildSandboxSettings` / `hostFromUrl` names and signatures are identical across Task 1 (def), Task 2 (`sandbox?: SandboxSettings`), and Task 3 (`sandboxPolicy?: SandboxPolicy`, `buildSandboxSettings(deps.sandboxPolicy)`). ✓

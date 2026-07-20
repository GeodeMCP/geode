# Vault Security Foundation — Slice 1A: Host-Approval Trust Model + AGENTS.md Lockdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single vault's tool-install/egress surface safe against a fully-compromised agent by enforcing a per-tool host allowlist the agent cannot self-grant, and by making the prompt-steering file (`AGENTS.md`) non-agent-writable.

**Architecture:** A tool's manifest (`TOOL.md`, agent-authored, git-tracked) *declares* the hosts it wants to reach. A separate trusted record outside the vault (`~/.geode/tools/<id>/hosts.json`) holds the human-*approved* hosts. Every credentialed egress path (`http` invoke, `cli` container egress) is enforced against the **approved** set, never the live manifest. Because enforcement is a positive allowlist, an edited manifest can never reach an unapproved host — this subsumes the manifest-hash-invalidation described in the spec (see "Deviation from spec" below). Three existing dashboard components surface the state: `ToolPanel` (manage), `NeedsAttention` (discover), `Chat` (approve just-in-time).

**Tech Stack:** Node 20, TypeScript (ESM, run via `tsx`), Vitest, Express (dashboard API), React + Vite (dashboard SPA). Backend tests in `test/`; frontend tests colocated as `*.test.tsx`.

**Scope:** This is slice 1A of the security foundation (spec: `docs/superpowers/specs/2026-07-20-vault-security-foundation-design.md`). It implements **Layer 3** (install = trusted decision) and **Layer 4** (AGENTS.md lockdown). It does **not** implement the broker/runner uid split (Layer 1) or the fetch/process egress split (Layer 2) — those are slice 1B. It does not touch multi-vault hosting (slice 2). All work here is buildable and testable on a single local vault.

## Global Constraints

- **English-only in code and UI strings.** No Dutch anywhere in the codebase (`CLAUDE.md`, memory `english-only-app-strings`).
- **New exports need JSDoc** or the husky pre-commit gate blocks the commit (`precommit-quality-gate`).
- **Surgical changes.** Touch only what each task requires; match existing style; do not refactor adjacent code.
- **The approved-hosts record must never live in the vault or in git.** It lives under `toolsDir` (`~/.geode/tools/<id>/`), the trusted side. Secrets and now host-grants are never vault files.
- **Enforce against the approved set, never the live manifest.** This is the load-bearing rule of Layer 3.
- **Reuse design tokens + existing class vocabulary** for all UI (`web/src/app.css`; classes like `ghost sm`, `btn sm`, `tp-section`, `na-glabel`, `tp-status ok|warn`). Introduce no new color/spacing values (`docs/design/geodemcp-visual-style.md`).
- Run `npm run typecheck` and `npm test` green before every commit.

## Deviation from spec (explicit)

The spec's Layer 3 lists "manifest hashing invalidates approval on edit." This plan does **not** implement a hash. Rationale: enforcement is a *positive per-host allowlist* checked at invoke — a manifest edit that adds or re-points a host simply leaves that host unapproved, so it is blocked without a hash. The hash would only catch same-approved-host behavioral edits (e.g. changing which data an already-approved call sends to an already-approved host), which is a manifest-integrity concern addressed by the Layer 1/2 trust split in slice 1B, not an egress-approval concern. This simplification is intentional and flagged for the spec reviewer.

**One more scope limit:** enforcement lands on the `http` (Task 3) and `cli` (Task 4) invoke paths. The `mcp` transport host appears in the UI (it is part of `declaredHosts`) but is **not yet enforced** at the `mcp` invoke path (`src/mcpProxy.ts`) in 1A — that enforcement is a small follow-up. It is lower-risk today because `mcp` stdio transport is unimplemented and http-transport mcp tools are uncommon. Do not claim mcp egress is enforced until that follow-up lands.

## File Structure

**Created:**
- `src/hostPolicy.ts` — pure helpers: extract a manifest's declared hosts, extract the target host of a resolved request, compute approved/pending status. No I/O.
- `src/approvals.ts` — the trusted per-tool approval record store (`hosts.json` under `toolsDir`): read, approve, revoke.
- `test/hostPolicy.test.ts`, `test/approvals.test.ts`, `test/hostEnforcement.test.ts`, `test/agentsMdLockdown.test.ts` — backend tests.

**Modified:**
- `src/invoke.ts` — enforce approved host on the `http` path.
- `src/sandboxRun.ts` — set the `cli` egress proxy allowlist to the approved hosts.
- `src/agentSandbox.ts` — add `AGENTS.md` to the protected-write set.
- `src/dashboard/api.ts` — host endpoints (list/approve/revoke), pending-hosts aggregate; stop auto-approving on install.
- `src/dashboard/ops.ts` — extend `ToolView` with `hosts: { approved: string[]; pending: string[] }`.
- `web/src/api.ts` — client helpers + `ToolView.hosts` type.
- `web/src/components/ToolPanel.tsx` (+ `.test.tsx`) — hosts management section.
- `web/src/components/NeedsAttention.tsx` (+ `.test.tsx`) — pending-hosts attention category.
- `web/src/components/Chat.tsx` (+ `.test.tsx`) — post-run approval card.
- `docs/design/mockups/host-approval-card.html` — mockup for the new Chat card (Task 10).

---

## Task 1: Host policy (pure helpers)

**Files:**
- Create: `src/hostPolicy.ts`
- Test: `test/hostPolicy.test.ts`

**Interfaces:**
- Consumes: `ToolManifest`, `HttpAction` from `src/tools.ts`.
- Produces:
  - `declaredHosts(m: ToolManifest): string[]` — every external host the tool may contact (http action URLs + `permissions.network` array entries + `transport.url` host), lowercased, de-duplicated, sorted. Hosts containing an unresolved `${...}` are returned verbatim (so a dynamic host is visible, not silently dropped).
  - `targetHost(url: string): string | null` — the lowercased hostname of a fully-resolved URL, or null if unparseable.
  - `hostStatus(m: ToolManifest, approved: string[]): { approved: string[]; pending: string[] }` — partitions `declaredHosts(m)` into those in `approved` and those not.

- [ ] **Step 1: Write the failing test**

```ts
// test/hostPolicy.test.ts
import { describe, it, expect } from "vitest";
import { declaredHosts, targetHost, hostStatus } from "../src/hostPolicy.js";
import type { ToolManifest } from "../src/tools.js";

const base = (over: Partial<ToolManifest>): ToolManifest => ({
  id: "t", name: "t", type: "http", description: "", actions: {}, ...over,
});

describe("declaredHosts", () => {
  it("collects hosts from http action urls, lowercased + sorted + deduped", () => {
    const m = base({ actions: {
      a: { http: { method: "GET", url: "https://API.Moneybird.nl/v2/x" } },
      b: { http: { method: "GET", url: "https://api.moneybird.nl/v2/y" } },
      c: { http: { method: "GET", url: "https://api.github.com/repos" } },
    } });
    expect(declaredHosts(m)).toEqual(["api.github.com", "api.moneybird.nl"]);
  });

  it("includes permissions.network array entries and transport host", () => {
    const m = base({ type: "cli", permissions: { network: ["registry.npmjs.org"] },
      transport: { kind: "http", url: "https://mcp.example.com/sse" } });
    expect(declaredHosts(m)).toEqual(["mcp.example.com", "registry.npmjs.org"]);
  });

  it("returns a dynamic host verbatim rather than dropping it", () => {
    const m = base({ actions: { a: { http: { method: "GET", url: "https://${conn.host}/x" } } } });
    expect(declaredHosts(m)).toContain("${conn.host}");
  });
});

describe("targetHost", () => {
  it("returns the lowercased hostname", () => {
    expect(targetHost("https://API.Example.com:443/a?b=c")).toBe("api.example.com");
  });
  it("returns null on an unparseable url", () => {
    expect(targetHost("not a url")).toBeNull();
  });
});

describe("hostStatus", () => {
  it("splits declared into approved and pending", () => {
    const m = base({ actions: {
      a: { http: { method: "GET", url: "https://api.moneybird.nl/x" } },
      b: { http: { method: "GET", url: "https://evil.com/x" } },
    } });
    expect(hostStatus(m, ["api.moneybird.nl"])).toEqual({
      approved: ["api.moneybird.nl"], pending: ["evil.com"],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hostPolicy.test.ts`
Expected: FAIL — cannot find module `../src/hostPolicy.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hostPolicy.ts
import type { ToolManifest } from "./tools.js";

/** The lowercased hostname of a fully-resolved URL, or null if it cannot be parsed. */
export function targetHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/** The host portion of a manifest URL that may still contain `${...}`; returns it verbatim when it cannot be parsed as a real URL so a dynamic host stays visible. */
function manifestUrlHost(url: string): string {
  const real = targetHost(url);
  if (real) return real;
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return (m ? m[1] : url).toLowerCase();
}

/** Every external host a tool may contact: http action URLs + `permissions.network` array entries + `transport.url`. Lowercased, de-duplicated, sorted. */
export function declaredHosts(m: ToolManifest): string[] {
  const hosts = new Set<string>();
  for (const a of Object.values(m.actions)) if (a.http?.url) hosts.add(manifestUrlHost(a.http.url));
  if (Array.isArray(m.permissions?.network)) for (const h of m.permissions.network) hosts.add(h.toLowerCase());
  if (m.transport?.url) hosts.add(manifestUrlHost(m.transport.url));
  return [...hosts].sort();
}

/** Partitions a manifest's declared hosts into those present in `approved` and those not. */
export function hostStatus(m: ToolManifest, approved: string[]): { approved: string[]; pending: string[] } {
  const set = new Set(approved.map((h) => h.toLowerCase()));
  const declared = declaredHosts(m);
  return { approved: declared.filter((h) => set.has(h)), pending: declared.filter((h) => !set.has(h)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hostPolicy.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/hostPolicy.ts test/hostPolicy.test.ts
git commit -m "feat(hosts): pure host-policy helpers (declared/target/status)"
```

---

## Task 2: Approval record store

**Files:**
- Create: `src/approvals.ts`
- Test: `test/approvals.test.ts`

**Interfaces:**
- Produces:
  - `interface ApprovalRecord { approvedHosts: string[]; updatedAt: string }`
  - `readApproval(toolsDir: string, id: string): Promise<ApprovalRecord>` — returns `{ approvedHosts: [], updatedAt: "" }` when no record exists (never throws on absence).
  - `approveHost(toolsDir: string, id: string, host: string): Promise<ApprovalRecord>` — adds `host` (lowercased) to the set, persists, returns the new record.
  - `revokeHost(toolsDir: string, id: string, host: string): Promise<ApprovalRecord>` — removes `host`, persists, returns the new record.
- Note: `updatedAt` uses `new Date().toISOString()` — matches the existing style in `src/installer.ts:27`.

- [ ] **Step 1: Write the failing test**

```ts
// test/approvals.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApproval, approveHost, revokeHost } from "../src/approvals.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "geode-appr-")); });

describe("approvals store", () => {
  it("reads an empty record when none exists", async () => {
    expect(await readApproval(dir, "moneybird")).toEqual({ approvedHosts: [], updatedAt: "" });
  });

  it("approves a host (lowercased) and reads it back", async () => {
    await approveHost(dir, "moneybird", "API.Moneybird.nl");
    expect((await readApproval(dir, "moneybird")).approvedHosts).toEqual(["api.moneybird.nl"]);
  });

  it("does not duplicate an already-approved host", async () => {
    await approveHost(dir, "moneybird", "api.moneybird.nl");
    const rec = await approveHost(dir, "moneybird", "api.moneybird.nl");
    expect(rec.approvedHosts).toEqual(["api.moneybird.nl"]);
  });

  it("revokes a host", async () => {
    await approveHost(dir, "moneybird", "api.moneybird.nl");
    const rec = await revokeHost(dir, "moneybird", "api.moneybird.nl");
    expect(rec.approvedHosts).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/approvals.test.ts`
Expected: FAIL — cannot find module `../src/approvals.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/approvals.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The human-approved host set for one tool. Lives under toolsDir (trusted side), never in the vault or git. */
export interface ApprovalRecord { approvedHosts: string[]; updatedAt: string }

const recPath = (toolsDir: string, id: string) => join(toolsDir, id, "hosts.json");

/** Reads a tool's approved-hosts record, or an empty record when none exists. */
export async function readApproval(toolsDir: string, id: string): Promise<ApprovalRecord> {
  try { return JSON.parse(await readFile(recPath(toolsDir, id), "utf8")) as ApprovalRecord; }
  catch { return { approvedHosts: [], updatedAt: "" }; }
}

/** Persists a mutated record. */
async function write(toolsDir: string, id: string, hosts: string[]): Promise<ApprovalRecord> {
  const rec: ApprovalRecord = { approvedHosts: [...new Set(hosts)].sort(), updatedAt: new Date().toISOString() };
  await mkdir(join(toolsDir, id), { recursive: true });
  await writeFile(recPath(toolsDir, id), JSON.stringify(rec, null, 2));
  return rec;
}

/** Adds a host (lowercased) to a tool's approved set. */
export async function approveHost(toolsDir: string, id: string, host: string): Promise<ApprovalRecord> {
  const cur = await readApproval(toolsDir, id);
  return write(toolsDir, id, [...cur.approvedHosts, host.toLowerCase()]);
}

/** Removes a host from a tool's approved set. */
export async function revokeHost(toolsDir: string, id: string, host: string): Promise<ApprovalRecord> {
  const cur = await readApproval(toolsDir, id);
  return write(toolsDir, id, cur.approvedHosts.filter((h) => h !== host.toLowerCase()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/approvals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/approvals.ts test/approvals.test.ts
git commit -m "feat(hosts): trusted per-tool approved-hosts store"
```

---

## Task 3: Enforce approved host on the `http` invoke path

**Files:**
- Modify: `src/invoke.ts` (the `http` branch, after `url` is resolved at line 36 and before the fetch at line 51)
- Test: `test/hostEnforcement.test.ts`

**Interfaces:**
- Consumes: `targetHost` (Task 1), `readApproval` (Task 2). `invoke`'s `deps` already carries `toolsDir?` (`src/invoke.ts:11`).
- Produces: `invoke` throws `Error("host not approved for tool \"<id>\": <host> — approve it in the dashboard before this action can run")` when the resolved target host is not in the tool's approved set. Enforcement applies only when `deps.toolsDir` is provided (the kernel always provides it; a bare unit caller opting out is unchanged).

**Note:** enforce against the *approved* record, never `manifest.permissions`. This is the whole point of Layer 3.

- [ ] **Step 1: Write the failing test**

```ts
// test/hostEnforcement.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/invoke.js";
import { approveHost } from "../src/approvals.js";

const store = { get: async () => "tok" };

async function vault(): Promise<{ root: string; toolsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "geode-vault-"));
  const toolsDir = await mkdtemp(join(tmpdir(), "geode-tools-"));
  await mkdir(join(root, "tools", "demo"), { recursive: true });
  await writeFile(join(root, "tools", "demo", "TOOL.md"),
`---
type: http
requires: [TOKEN]
connections: [{ label: default }]
actions:
  ping:
    http: { method: GET, url: "https://api.example.com/ping", headers: { authorization: "Bearer \${conn.TOKEN}" } }
---
`);
  return { root, toolsDir };
}

describe("http host enforcement", () => {
  let root: string, toolsDir: string;
  beforeEach(async () => { ({ root, toolsDir } = await vault()); });

  it("blocks an invoke whose target host is not approved", async () => {
    await expect(invoke({ root, toolsDir, secrets: store }, { tool: "demo", action: "ping" }))
      .rejects.toThrow(/host not approved for tool "demo": api\.example\.com/);
  });

  it("allows the invoke once the host is approved", async () => {
    await approveHost(toolsDir, "demo", "api.example.com");
    const fetchFn = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const r = await invoke({ root, toolsDir, secrets: store, fetchFn }, { tool: "demo", action: "ping" });
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hostEnforcement.test.ts`
Expected: FAIL — the block test rejects with no error (invoke tries to fetch `api.example.com` and errors on network, not on approval), and/or the allow test passes for the wrong reason. Confirm the *first* test fails to match the expected message.

- [ ] **Step 3: Write minimal implementation**

In `src/invoke.ts`, add the import at the top:

```ts
import { targetHost } from "./hostPolicy.js";
import { readApproval } from "./approvals.js";
```

Then, in the `http` branch, insert the check immediately after `const url = resolveTemplate(http.url, ctx);` (currently line 36):

```ts
  if (deps.toolsDir) {
    const host = targetHost(url);
    const { approvedHosts } = await readApproval(deps.toolsDir, args.tool);
    if (!host || !approvedHosts.includes(host)) {
      throw new Error(`host not approved for tool "${args.tool}": ${host ?? url} — approve it in the dashboard before this action can run`);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hostEnforcement.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npx vitest run` — existing `invoke` tests that call without `toolsDir` must still pass (enforcement is gated on `deps.toolsDir`). If an existing test provides `toolsDir` and now fails on approval, add an `approveHost` call to that test's setup.

- [ ] **Step 6: Commit**

```bash
git add src/invoke.ts test/hostEnforcement.test.ts
git commit -m "feat(hosts): enforce approved host on http invoke path"
```

---

## Task 4: Enforce approved hosts on the `cli` container egress

**Files:**
- Modify: `src/sandboxRun.ts:28-33` (where `networkSpec`/`isAllowlist`/`network`/`proxy` are computed)
- Test: extend `test/hostEnforcement.test.ts`

**Interfaces:**
- Consumes: `readApproval` (Task 2).
- Produces: for a `cli` tool, the egress-proxy allowlist is the tool's **approved** hosts (intersected with reality), not `manifest.permissions.network`. When the approved set is empty, the container runs with `network: "none"`.

**Note:** the pre-existing container↔proxy reachability bug (`security-model.md:129-136`) is out of scope here; this task only changes *which* host list the proxy is built from — the approved set instead of the live manifest.

- [ ] **Step 1: Write the failing test** (append to `test/hostEnforcement.test.ts`)

```ts
import { computeCliNetwork } from "../src/sandboxRun.js";

describe("cli egress uses approved hosts, not the manifest", () => {
  it("returns network:none and no proxy list when nothing is approved", () => {
    expect(computeCliNetwork(["registry.npmjs.org"], [])).toEqual({ network: "none", allow: [] });
  });
  it("restricts the proxy allowlist to approved hosts", () => {
    expect(computeCliNetwork(["registry.npmjs.org", "evil.com"], ["registry.npmjs.org"]))
      .toEqual({ network: "bridge", allow: ["registry.npmjs.org"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hostEnforcement.test.ts`
Expected: FAIL — `computeCliNetwork` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/sandboxRun.ts`, add the imports:

```ts
import { readApproval } from "./approvals.js";
```

Add the pure helper (exported, so it is unit-testable) near the top of the file:

```ts
/** Decides the container network mode + egress allowlist from a tool's declared hosts and its approved set: only approved hosts may be reached; none approved → no network. */
export function computeCliNetwork(declaredNetwork: string[] | undefined, approved: string[]): { network: "none" | "bridge"; allow: string[] } {
  const declared = Array.isArray(declaredNetwork) ? declaredNetwork : [];
  const allow = declared.filter((h) => approved.includes(h.toLowerCase()));
  return allow.length ? { network: "bridge", allow } : { network: "none", allow: [] };
}
```

Then replace the current lines (`src/sandboxRun.ts:28-33`):

```ts
  const networkSpec = m.permissions?.network;
  const isAllowlist = Array.isArray(networkSpec);
  const network = !networkSpec || networkSpec === "none" ? "none" : "bridge";
  const dir = await mkdtemp(join(tmpdir(), "geode-env-"));
  const envFile = join(dir, "env");
  const proxy = isAllowlist ? await startEgressProxy(networkSpec as string[]) : null;
```

with:

```ts
  const approved = (await readApproval(deps.toolsDir, toolId)).approvedHosts;
  const { network, allow } = computeCliNetwork(Array.isArray(m.permissions?.network) ? m.permissions.network as string[] : undefined, approved);
  const dir = await mkdtemp(join(tmpdir(), "geode-env-"));
  const envFile = join(dir, "env");
  const proxy = allow.length ? await startEgressProxy(allow) : null;
```

(`network: "any"` in a manifest no longer grants blanket egress — a cli tool now reaches only its approved declared hosts. Note this in the commit body.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hostEnforcement.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: green. Fix any `sandboxRun` integration test that assumed `network: any`.

- [ ] **Step 6: Commit**

```bash
git add src/sandboxRun.ts test/hostEnforcement.test.ts
git commit -m "feat(hosts): cli egress allowlist derives from approved hosts, not manifest"
```

---

## Task 5: Lock down `AGENTS.md` (Layer 4)

**Files:**
- Modify: `src/agentSandbox.ts:36-38` (the `GENERATED_FILES` set) and the deny message in `buildPermissionHandler` (`:154-155`)
- Test: `test/agentsMdLockdown.test.ts`

**Interfaces:**
- Consumes: `buildPermissionHandler(writeRoots)` from `src/agentSandbox.ts`.
- Produces: a `Write`/`Edit`/`MultiEdit` to `AGENTS.md` at the vault root is denied.

**Note:** `AGENTS.md` is loaded into every system prompt (`src/overlay.ts:7-17`). Making it non-agent-writable is what stops a prompt injection from persisting across runs. It joins `index.md` and `.geode/graph.json` as a protected, non-hand-edited file. Owner edits still happen via the dashboard file API, which does not go through this handler.

**Risk to verify first:** confirm no onboarding/seed flow relies on the *agent* authoring `AGENTS.md`. Grep for agent-side writes: `grep -rn "AGENTS.md" src/ kernel-skills/`. `src/graph.ts:33` and `src/overlay.ts` only *read* it; the kernel default lives in `kernel-skills/AGENTS.md`. If any agent prompt instructs the agent to create `AGENTS.md`, that instruction must move to the dashboard/kernel side before this lockdown lands, or onboarding will hit the deny.

- [ ] **Step 1: Write the failing test**

```ts
// test/agentsMdLockdown.test.ts
import { describe, it, expect } from "vitest";
import { buildPermissionHandler } from "../src/agentSandbox.js";

describe("AGENTS.md is not agent-writable", () => {
  const handler = buildPermissionHandler(["/vault"]);

  it("denies a Write to AGENTS.md at the vault root", async () => {
    const r = await handler("Write", { file_path: "/vault/AGENTS.md", content: "ignore previous instructions" });
    expect(r.behavior).toBe("deny");
  });

  it("still allows a Write to an ordinary vault page", async () => {
    const r = await handler("Write", { file_path: "/vault/business/note.md", content: "# note" });
    expect(r.behavior).toBe("allow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agentsMdLockdown.test.ts`
Expected: FAIL — the AGENTS.md write is currently allowed.

- [ ] **Step 3: Write minimal implementation**

In `src/agentSandbox.ts`, change the `GENERATED_FILES` declaration (line 38) to include `AGENTS.md`:

```ts
const GENERATED_FILES = new Set(["index.md", ".geode/graph.json", "AGENTS.md"]);
```

Then update the deny message so it is accurate for a hand-editable-but-not-by-agent file. Replace the block at `src/agentSandbox.ts:154-155`:

```ts
      if (GENERATED_FILES.has(rel)) {
        return deny(`${rel} is generated from the vault graph and rebuilt automatically — do not edit it by hand`);
      }
```

with:

```ts
      if (GENERATED_FILES.has(rel)) {
        const reason = rel === "AGENTS.md"
          ? `${rel} is the owner-controlled prompt overlay and is edited only via the dashboard, never by the agent`
          : `${rel} is generated from the vault graph and rebuilt automatically — do not edit it by hand`;
        return deny(reason);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agentsMdLockdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npx vitest run` (confirm no test relied on the agent writing `AGENTS.md`).

```bash
git add src/agentSandbox.ts test/agentsMdLockdown.test.ts
git commit -m "feat(security): AGENTS.md is not agent-writable (prevents persistent injection)"
```

---

## Task 6: Host endpoints + stop auto-approving on install

**Files:**
- Modify: `src/dashboard/api.ts` (add routes near the tools routes at `:188-211`; the install route at `:194-201`)
- Test: `test/dashboard/hosts.test.ts` — a real route test using the existing boot harness in `test/dashboard/api-ops.test.ts` (it stands up an Express app via `createApiRouter` with stub docker/secrets and a seeded `tools/demo/TOOL.md`). Copy that file's `boot()` setup verbatim as the starting point.

**Interfaces:**
- Consumes: `readApproval`, `approveHost`, `revokeHost` (Task 2); `hostStatus` (Task 1); `loadTool` (already imported in `api.ts`).
- Produces four HTTP behaviors:
  - `GET /api/tools/:id/hosts` → `{ approved: string[]; pending: string[] }`
  - `POST /api/tools/:id/hosts/approve` body `{ host: string }` → `{ approved, pending }`
  - `DELETE /api/tools/:id/hosts/:host` → `{ approved, pending }`
  - `GET /api/hosts/pending` → `{ tool: string; host: string }[]` (aggregate across all tools, for `NeedsAttention`)
  - **Behavior change:** `POST /api/tools/:id/install` no longer passes `manifest.permissions` as approved — installing builds the image but grants **no** hosts (closes hole G). Pass `{}`.

- [ ] **Step 1: Write the failing test** — a real route test. Copy the `boot()` harness from `test/dashboard/api-ops.test.ts` (Express app + `createApiRouter` with `toolsDir: root`, stub docker, a seeded `tools/demo/TOOL.md` whose action URL is `https://h/p`). Then assert the three host routes end-to-end:

```ts
// test/dashboard/hosts.test.ts — after copying boot() from api-ops.test.ts
test("GET /hosts reports the declared host as pending, approve moves it, revoke removes it", async () => {
  // the seeded demo tool's action url is https://h/p → declared host "h"
  let r = await fetch(`${url}/api/tools/demo/hosts`);
  expect(await r.json()).toEqual({ approved: [], pending: ["h"] });

  r = await fetch(`${url}/api/tools/demo/hosts/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: "h" }) });
  expect(await r.json()).toEqual({ approved: ["h"], pending: [] });

  r = await fetch(`${url}/api/hosts/pending`);
  expect(await r.json()).toEqual([]); // nothing pending once approved

  r = await fetch(`${url}/api/tools/demo/hosts/h`, { method: "DELETE" });
  expect(await r.json()).toEqual({ approved: [], pending: ["h"] });
});
```

(The api-ops harness mounts the router without the session guard, so these calls need no cookie — match how api-ops.test.ts already calls `/api/tools/...`. `toolsDir` is a fresh tmp dir, so `hosts.json` starts absent.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dashboard/hosts.test.ts`
Expected: FAIL — routes 404 (not yet added).

- [ ] **Step 3: Write the implementation**

Add imports at the top of `src/dashboard/api.ts`:

```ts
import { readApproval, approveHost, revokeHost } from "../approvals.js";
import { hostStatus } from "../hostPolicy.js";
```

Add these routes next to the other `/tools` routes (after `:211`):

```ts
  const hostsOf = async (id: string) => {
    const manifest = await loadTool(deps.workspace.root, id);
    const { approvedHosts } = await readApproval(deps.toolsDir, id);
    return hostStatus(manifest, approvedHosts);
  };
  router.get("/tools/:id/hosts", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { res.json(await hostsOf(req.params.id)); } catch { res.status(404).json({ error: "unknown tool" }); }
  });
  router.post("/tools/:id/hosts/approve", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    const host = String(req.body?.host ?? "").trim().toLowerCase();
    if (!host) { res.status(400).json({ error: "host required" }); return; }
    try { await approveHost(deps.toolsDir, req.params.id, host); res.json(await hostsOf(req.params.id)); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.delete("/tools/:id/hosts/:host", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { await revokeHost(deps.toolsDir, req.params.id, decodeURIComponent(req.params.host)); res.json(await hostsOf(req.params.id)); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.get("/hosts/pending", async (_req, res) => {
    const out: { tool: string; host: string }[] = [];
    for (const t of await listTools(deps.workspace.root, deps.toolsDir, deps.secrets)) {
      for (const host of t.hosts.pending) out.push({ tool: t.id, host });
    }
    res.json(out);
  });
```

Change the install route (`:198`) from:

```ts
      const state = await installTool({ root: deps.workspace.root, toolsDir: deps.toolsDir, docker: deps.docker }, req.params.id, manifest.permissions ?? {});
```

to:

```ts
      // Installing builds the image but grants NO hosts — egress is approved separately, per host, via /hosts/approve.
      const state = await installTool({ root: deps.workspace.root, toolsDir: deps.toolsDir, docker: deps.docker }, req.params.id, {});
```

(`listTools` is already imported in `api.ts`; `t.hosts` comes from Task 7's `ToolView` extension. Task 7 must land before `/hosts/pending` typechecks — do Task 7's `ops.ts` change and this route in either order but commit them so the build is green.)

- [ ] **Step 4: Manual verification against the running kernel**

Start the kernel (`npx tsx --env-file=.env src/index.ts`), then with a session cookie (log in via the dashboard) or by testing the pure pieces, confirm:

```bash
curl -s localhost:8787/api/tools/<id>/hosts        # {"approved":[],"pending":["api.moneybird.nl"]}
curl -s -X POST localhost:8787/api/tools/<id>/hosts/approve -H 'content-type: application/json' -d '{"host":"api.moneybird.nl"}'
# {"approved":["api.moneybird.nl"],"pending":[]}
```

- [ ] **Step 5: Run the route test to verify it passes**

Run: `npx vitest run test/dashboard/hosts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit** (Task 7's `ToolView.hosts` must land for `/hosts/pending` to typecheck — if doing Task 6 before Task 7, add the `ToolView.hosts` field in `ops.ts` as part of this commit, or sequence Task 7 first)

```bash
git add src/dashboard/api.ts test/dashboard/hosts.test.ts
git commit -m "feat(hosts): host list/approve/revoke routes; install no longer auto-approves hosts"
```

---

## Task 7: Extend `ToolView` with host status (backend → client type)

**Files:**
- Modify: `src/dashboard/ops.ts` (`ToolView` interface `:8-17`, `toView` `:38-43`)
- Modify: `web/src/api.ts` (`ToolView` type `:4`; add client helpers `:64-68`)
- Test: extend an existing `ops` test if present, else covered by UI tests.

**Interfaces:**
- Consumes: `readApproval` (Task 2), `hostStatus` (Task 1).
- Produces: `ToolView.hosts: { approved: string[]; pending: string[] }` on both the backend `ops.ts` view and the frontend `web/src/api.ts` type; client helpers `api.toolHosts(id)`, `api.approveHost(id, host)`, `api.revokeHost(id, host)`, `api.pendingHosts()`.

- [ ] **Step 1: Backend — extend `ToolView` and `toView`**

In `src/dashboard/ops.ts`, add the imports:

```ts
import { readApproval } from "../approvals.js";
import { hostStatus } from "../hostPolicy.js";
```

Add to the `ToolView` interface (after `permissions` at `:16`):

```ts
  /** Declared external hosts split into approved (human-blessed) and pending (awaiting approval). */
  hosts: { approved: string[]; pending: string[] };
```

In `toView` (`:38-42`), before the `return`, compute hosts and include them:

```ts
  const { approvedHosts } = await readApproval(toolsDir, m.id);
  const hosts = hostStatus(m, approvedHosts);
```

and add `hosts,` to the returned object.

- [ ] **Step 2: Frontend — mirror the type + add client helpers**

In `web/src/api.ts`, extend the `ToolView` interface (`:4`) by appending before the closing `}`:

```ts
; hosts: { approved: string[]; pending: string[] } }
```

(i.e. the interface now ends `...permissions: {...} | undefined; hosts: { approved: string[]; pending: string[] } }`.)

Add to the `api` object (after `testAction` at `:68`):

```ts
  toolHosts: (id: string) => json<{ approved: string[]; pending: string[] }>(`/api/tools/${encodeURIComponent(id)}/hosts`),
  approveHost: (id: string, host: string) => json<{ approved: string[]; pending: string[] }>(`/api/tools/${encodeURIComponent(id)}/hosts/approve`, { method: "POST", body: JSON.stringify({ host }) }),
  revokeHost: (id: string, host: string) => json<{ approved: string[]; pending: string[] }>(`/api/tools/${encodeURIComponent(id)}/hosts/${encodeURIComponent(host)}`, { method: "DELETE" }),
  pendingHosts: () => json<{ tool: string; host: string }[]>("/api/hosts/pending"),
```

- [ ] **Step 3: Typecheck both**

Run: `npm run typecheck` (backend) and `cd web && npx tsc --noEmit` (frontend). Both green.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/ops.ts web/src/api.ts
git commit -m "feat(hosts): ToolView.hosts (approved/pending) + client api helpers"
```

---

## Task 8: ToolPanel — hosts management section (the "manage" surface)

**Files:**
- Modify: `web/src/components/ToolPanel.tsx` (add a section after Connections, `:123`)
- Test: `web/src/components/ToolPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `tool.hosts` (Task 7), `api.approveHost`, `api.revokeHost` (Task 7).
- Produces: a "Hosts" section listing approved hosts (with a Revoke button each) and pending hosts (with an Approve button each), reusing the existing `tp-section` / `na-glabel` / `tp-status` / `ghost sm` / `btn sm` vocabulary. Re-fetches the tool via the existing `load()` after a change.

- [ ] **Step 1: Write the failing test** (mirror the existing `ToolPanel.test.tsx` render/mocking pattern)

```tsx
// add to web/src/components/ToolPanel.test.tsx
it("shows pending hosts with an Approve button and approves them", async () => {
  // mock api.tool to return one pending host, api.approveHost to move it to approved
  // render <ToolPanel id="demo" />, find the pending host row, click Approve,
  // assert api.approveHost was called with ("demo", "api.moneybird.nl")
  // (follow the existing file's mocking style for `../api`)
});
```

Write it concretely against the file's existing mocking approach (the file already mocks `../api` for install/uninstall — extend that mock with `tool: async () => ({ ...baseTool, hosts: { approved: [], pending: ["api.moneybird.nl"] } })` and `approveHost: vi.fn(async () => ({ approved: ["api.moneybird.nl"], pending: [] }))`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/ToolPanel.test.tsx`
Expected: FAIL — no Hosts section / Approve button rendered.

- [ ] **Step 3: Write minimal implementation**

Add handlers inside the component (near `setupConnection`, `:57`):

```tsx
  const approve = async (host: string) => { try { await api.approveHost(id, host); await load(); } catch { /* surfaced on reload */ } };
  const revoke = async (host: string) => { try { await api.revokeHost(id, host); await load(); } catch { /* surfaced on reload */ } };
```

Add this section immediately after the Connections `</section>` (`:123`):

```tsx
        <section className="tp-section">
          <div className="na-glabel">Hosts <span className="na-count">{tool.hosts.approved.length + tool.hosts.pending.length}</span></div>
          {tool.hosts.approved.length === 0 && tool.hosts.pending.length === 0 && <p className="tp-hint">This tool declares no external hosts.</p>}
          {tool.hosts.pending.map((h) => (
            <div key={h} className="tp-conn">
              <div className="tp-conn-main"><b>{h}</b></div>
              <span className="tp-status warn">pending</span>
              <button className="btn sm" onClick={() => approve(h)}>Approve</button>
            </div>
          ))}
          {tool.hosts.approved.map((h) => (
            <div key={h} className="tp-conn">
              <div className="tp-conn-main"><b>{h}</b></div>
              <span className="tp-status ok">approved</span>
              <button className="ghost sm" onClick={() => revoke(h)}>Revoke</button>
            </div>
          ))}
          {tool.hosts.pending.length > 0 && <p className="tp-hint" style={{ marginTop: 4 }}>A tool can only reach approved hosts. Approve one to allow this tool to call it.</p>}
        </section>
```

- [ ] **Step 4: Run test + typecheck**

Run: `cd web && npx vitest run src/components/ToolPanel.test.tsx && npx tsc --noEmit`
Expected: PASS + green.

- [ ] **Step 5: Verify in the running dashboard**

Start the kernel, open a tool with a declared host, confirm the Hosts section renders on-style (approved = green `ok`, pending = amber `warn`), and Approve/Revoke round-trip. Screenshot beside an existing panel to confirm it does not read as pasted-in.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ToolPanel.tsx web/src/components/ToolPanel.test.tsx
git commit -m "feat(hosts): ToolPanel hosts section (approve/revoke)"
```

---

## Task 9: NeedsAttention — pending-hosts category (the "discover" surface)

**Files:**
- Modify: `web/src/components/NeedsAttention.tsx` (the `refresh` aggregation `:28-36` and the drawer body)
- Test: `web/src/components/NeedsAttention.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.pendingHosts()` (Task 7).
- Produces: pending host approvals appear as a category in the drawer, counted into the bell badge; each item links to (opens) the tool's panel via the existing `onOpenSettings`/navigation pattern the component already uses for tools.

- [ ] **Step 1: Write the failing test**

Extend `NeedsAttention.test.tsx`: mock `api.pendingHosts` to return `[{ tool: "moneybird", host: "api.moneybird.nl" }]`, render, open the drawer, assert the host row is shown and the badge count includes it. Follow the file's existing mock-and-open pattern (it already mocks `api.status`, `api.tools`, `api.gaps`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/NeedsAttention.test.tsx`
Expected: FAIL — pending hosts not shown.

- [ ] **Step 3: Write minimal implementation**

Add state + fetch. In `refresh` (`:28`), add `api.pendingHosts().catch(() => [])` to the `Promise.all` and store it:

```tsx
  const [pendingHostList, setPendingHostList] = useState<{ tool: string; host: string }[]>([]);
```
```tsx
    const [s, tools, g, ph] = await Promise.all([
      api.status().catch(() => ({ modified: [], created: [] })),
      api.tools().catch(() => []),
      api.gaps().catch(() => ({ gaps: [] })),
      api.pendingHosts().catch(() => []),
    ]);
    setStatus(s); setSetup(pendingSetup(tools)); setGaps(g.gaps); setPendingHostList(ph);
```

Include `pendingHostList.length` in the total-count badge (add it to the same sum the component already computes), and render a category block in the drawer body, matching the existing gap/setup block markup:

```tsx
        {pendingHostList.length > 0 && (
          <div className="na-group">
            <div className="na-glabel">Hosts awaiting approval <span className="na-count">{pendingHostList.length}</span></div>
            {pendingHostList.map((p) => (
              <button key={`${p.tool}:${p.host}`} className="na-item" onClick={() => { onOpenSettings(); /* deep-link to the tool panel as the existing setup items do */ }}>
                <b>{p.host}</b><span className="na-sub">{p.tool}</span>
              </button>
            ))}
          </div>
        )}
```

(Match the exact class names the component already uses for its groups — inspect the existing gap/setup rendering and reuse those classes rather than inventing `na-group`/`na-item`/`na-sub` if they differ.)

- [ ] **Step 4: Run test + typecheck + verify in running UI**

Run: `cd web && npx vitest run src/components/NeedsAttention.test.tsx && npx tsc --noEmit`
Then confirm in the running dashboard that the bell badge counts a pending host and the drawer lists it, clicking through to the tool.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/NeedsAttention.tsx web/src/components/NeedsAttention.test.tsx
git commit -m "feat(hosts): pending host approvals surface in NeedsAttention"
```

---

## Task 10: Chat approval card (the "just-in-time" surface) — mockup first

**Files:**
- Create: `docs/design/mockups/host-approval-card.html` (mockup, committed)
- Modify: `web/src/components/Chat.tsx` (render a card after a run completes when new pending hosts exist)
- Test: `web/src/components/Chat.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.pendingHosts()`, `api.approveHost()` (Task 7).
- Produces: after a run finishes, if the vault has pending host approvals, an inline card renders in the chat stream naming the tool + host with Approve / Dismiss, reusing existing chat message/card classes. Approving calls `api.approveHost` and removes the card.

**This is the one genuinely-new visual element — mock it and get operator sign-off before writing the component code.**

- [ ] **Step 1: Build the mockup**

Use the frontend-design skill. Create `docs/design/mockups/host-approval-card.html` — a static HTML page loading the real tokens from `web/src/app.css` (or inlining the relevant custom properties), showing the approval card as it will appear inside the chat stream: tool name, host, a one-line rationale, an emerald **Approve** and a ghost **Dismiss** button. Keep it token-only; no new colors.

- [ ] **Step 2: Get operator sign-off**

Present the mockup to the operator. **Do not proceed to Step 3 until approved.** Iterate on the mockup, not the component.

- [ ] **Step 3: Write the failing test**

Extend `Chat.test.tsx`: after simulating a completed run, mock `api.pendingHosts` to return one item and assert the card renders with an Approve button; clicking it calls `api.approveHost` and the card disappears. Follow the file's existing run-simulation + `../api` mock pattern.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/Chat.test.tsx`
Expected: FAIL — no card rendered.

- [ ] **Step 5: Write minimal implementation**

After a run completes (where `Chat` already handles run completion), fetch `api.pendingHosts()` and store it; render the card matching the approved mockup, using existing chat card classes. Approving:

```tsx
  const approveHost = async (tool: string, host: string) => {
    await api.approveHost(tool, host);
    setPendingHosts((xs) => xs.filter((p) => !(p.tool === tool && p.host === host)));
  };
```

Render each pending item as a card in the stream (exact classes taken from the approved mockup and the existing chat message markup).

- [ ] **Step 6: Run test + typecheck + verify in running UI**

Run: `cd web && npx vitest run src/components/Chat.test.tsx && npx tsc --noEmit`
Then, in the running dashboard: ask the vault to author a tool that declares a host, and confirm the approval card appears after the run and approving it works and clears it.

- [ ] **Step 7: Commit**

```bash
git add docs/design/mockups/host-approval-card.html web/src/components/Chat.tsx web/src/components/Chat.test.tsx
git commit -m "feat(hosts): post-run chat approval card for pending hosts"
```

---

## Final verification

- [ ] `npm run typecheck` — green.
- [ ] `npx vitest run` (backend) — green.
- [ ] `cd web && npx vitest run && npx tsc --noEmit` (frontend) — green.
- [ ] `npm run lint` — green.
- [ ] **Manual end-to-end on the running kernel:**
  1. A tool with a declared host cannot be invoked until its host is approved (invoke returns the "host not approved" error).
  2. Approving the host in ToolPanel makes the invoke succeed.
  3. Revoking it makes the next invoke fail again.
  4. Installing a cli tool grants no hosts (its declared hosts appear as pending).
  5. The agent cannot write `AGENTS.md` (ask it to; the run reports the deny).
  6. A pending host shows in NeedsAttention and (after a run that declares one) in the Chat card.
- [ ] Update `.agent/System/security-model.md` to reflect: hosts enforced against the approved record (holes E/F/G closed at the enforcement layer), `AGENTS.md` non-agent-writable (hole D closed). Update the "Confirmed bypasses" section accordingly.

## Spec coverage note

This plan covers spec Layers 3 and 4 (holes D, E, F, G). Holes A, B, C (unbounded reads, key-beside-ciphertext, open agent egress) require the broker/runner uid split and fetch/process egress split — **slice 1B**, a separate plan.

# Vault Security 1B-1b: Runner uid Trust Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the same-uid runner subprocess (shipped in 1B-1) into a real trust boundary: scrub the runner's environment down to an allowlist (so it never receives the master secret key), drop the runner to a distinct low-privilege uid/gid when the broker is privileged, and prove — via a Linux Docker harness — that the runner cannot read the broker's secrets while it can still write and get its vault committed.

**Architecture:** The single seam is the runner spawn at `src/index.ts:71-77`. A new `provisionRunner(config)` computes `{ uid?, gid?, cwd, env }` and feeds it through the existing `spawnOptions` — `src/subprocessEngine.ts` is untouched. Env is built from an **allowlist** (never a filtered `process.env`). uid/gid are set only when a boot-time `process.getuid?.() === 0` pre-flight passes and a runner account is configured; otherwise a loud same-uid fallback (macOS dev / non-root). The OS ownership model (shared-group `2770` working tree, `0700` secrets, group-readable staging) is applied by deploy-time provisioning, not the kernel.

**Tech Stack:** Node 20, TypeScript ESM run via tsx, Vitest, Docker (node:20-bookworm) for the adversarial verification.

**Scope:** Slice 1B-1b — the uid/env trust boundary (spec `docs/superpowers/specs/2026-07-20-vault-security-foundation-design.md` §6.4 + §6.5). It does NOT split fetch/process roles (Layer 2 = slice 1B-2) and does NOT touch multi-vault hosting (slice 2). On a non-root host (macOS dev) it runs same-uid with a loud log — the real uid boundary only materializes on a privileged Linux host, validated here via Docker.

## Global Constraints

- **English-only** in code and comments. **New exports need JSDoc** (husky gate). **Surgical** changes; match existing style.
- **Env is an allowlist, never a denylist.** The runner env is assembled from an explicit set (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` if set, `PATH`, a runner-owned `HOME` + `TMPDIR`) — never `process.env` filtered. A denylist silently leaks the next secret var someone adds.
- **The runner env must contain no `GEODE_*` key.** This is the load-bearing security property — `GEODE_SECRETS_KEY` in the broker env is the master AES key that decrypts `secrets.enc`.
- **`subprocessEngine.ts` does not change** — uid/gid/env ride through `spawnOptions`.
- **Same-uid fallback must be loud and deterministic** — one boot-time decision (`process.getuid?.() === 0` + runner account configured), logged, not a per-run EPERM catch.
- Run `npm run typecheck` and `npm test` green before every commit.

## Existing seam (from `src/index.ts:71-77`)

```ts
engine: createSubprocessEngine({
  runnerCommand: process.execPath,
  runnerArgs: ["--import", "tsx", runnerEntry],
  spawnOptions: { cwd: pkgRoot, env: process.env },   // <-- 1B-1b replaces the env + adds uid/gid
}),
```

## File Structure

**Created:**
- `src/runner/provision.ts` — pure helpers: `buildRunnerEnv(...)` (the allowlist), `resolveRunnerPrivilege(...)` (root pre-flight → uid/gid or fallback), and `provisionRunner(config, deps)` (assembles the full `spawnOptions` + logs the mode).
- `test/runner/provision.test.ts` — unit tests.
- `Dockerfile` — Linux image provisioning the shared group + broker/runner users, for the adversarial check.
- `scripts/verify-uid-boundary.ts` — the API-key-free adversarial harness (runner uid gets EACCES on secrets; can write+commit vault).
- `docs/SOP` note or `.agent/SOP/verify-uid-boundary.md` — how to run the Docker check.

**Modified:**
- `src/config.ts` — add `runnerUid?`, `runnerGid?`, `runnerHome` config.
- `src/index.ts:71-77` — call `provisionRunner(...)` for `spawnOptions`.
- `.agent/System/security-model.md` — document the uid boundary + env scrub as now-enforced (privileged) / fallback (dev).

---

## Task 1: Config for the runner account

**Files:**
- Modify: `src/config.ts` (the `Config` interface + `loadConfig`)
- Test: extend `test/config.test.ts` (if present; else add `test/runnerConfig.test.ts`)

**Interfaces:**
- Produces on `Config`: `runnerUid?: number` (`GEODE_RUNNER_UID`), `runnerGid?: number` (`GEODE_RUNNER_GID`), `runnerHome: string` (`GEODE_RUNNER_HOME`, default `join(homedir(), ".geode", "runner-home")`).

- [ ] **Step 1: Write the failing test**

```ts
// test/runnerConfig.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { homedir } from "node:os";
import { join } from "node:path";

const base = { GEODE_AUTH_TOKEN: "t", GEODE_WORKSPACE: "/v" };

describe("runner config", () => {
  it("parses runner uid/gid as numbers and defaults runnerHome", () => {
    const c = loadConfig({ ...base, GEODE_RUNNER_UID: "1001", GEODE_RUNNER_GID: "1002" });
    expect(c.runnerUid).toBe(1001);
    expect(c.runnerGid).toBe(1002);
    expect(c.runnerHome).toBe(join(homedir(), ".geode", "runner-home"));
  });
  it("leaves uid/gid undefined when unset (same-uid mode)", () => {
    const c = loadConfig(base);
    expect(c.runnerUid).toBeUndefined();
    expect(c.runnerGid).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/runnerConfig.test.ts` → FAIL (fields absent).

- [ ] **Step 3: Implement** — add to the `Config` interface (`src/config.ts`):

```ts
  runnerUid?: number;
  runnerGid?: number;
  runnerHome: string;
```

and to the returned object in `loadConfig`:

```ts
    runnerUid: env.GEODE_RUNNER_UID ? Number(env.GEODE_RUNNER_UID) : undefined,
    runnerGid: env.GEODE_RUNNER_GID ? Number(env.GEODE_RUNNER_GID) : undefined,
    runnerHome: env.GEODE_RUNNER_HOME || join(homedir(), ".geode", "runner-home"),
```

(`homedir`/`join` are already imported in `config.ts`.)

- [ ] **Step 4: Run test** — `npx vitest run test/runnerConfig.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/config.ts test/runnerConfig.test.ts && git commit -m "feat(runner): config for runner uid/gid/home"`

---

## Task 2: Runner env allowlist

**Files:**
- Create: `src/runner/provision.ts`, `test/runner/provision.test.ts`

**Interfaces:**
- Produces: `buildRunnerEnv(source: NodeJS.ProcessEnv, opts: { home: string; tmpdir: string }): NodeJS.ProcessEnv` — returns ONLY: `ANTHROPIC_API_KEY` (if present), `ANTHROPIC_BASE_URL` (if present), `PATH` (from source), `HOME` = `opts.home`, `TMPDIR` = `opts.tmpdir`. Nothing else. Never a `GEODE_*` key.

- [ ] **Step 1: Write the failing test**

```ts
// test/runner/provision.test.ts
import { describe, it, expect } from "vitest";
import { buildRunnerEnv } from "../../src/runner/provision.js";

describe("buildRunnerEnv", () => {
  const source = {
    ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "https://gw", PATH: "/usr/bin",
    GEODE_SECRETS_KEY: "MASTER", GEODE_AUTH_TOKEN: "tok", GEODE_SIGN_KEY: "s",
    HOME: "/root", SECRET_SOMETHING: "nope",
  } as NodeJS.ProcessEnv;

  it("forwards only the allowlist and overrides HOME/TMPDIR", () => {
    const env = buildRunnerEnv(source, { home: "/runner-home", tmpdir: "/runner-tmp" });
    expect(env).toEqual({
      ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "https://gw",
      PATH: "/usr/bin", HOME: "/runner-home", TMPDIR: "/runner-tmp",
    });
  });

  it("contains NO GEODE_* key (the load-bearing property)", () => {
    const env = buildRunnerEnv(source, { home: "/h", tmpdir: "/t" });
    expect(Object.keys(env).some((k) => k.startsWith("GEODE_"))).toBe(false);
  });

  it("omits ANTHROPIC_BASE_URL when the source lacks it", () => {
    const env = buildRunnerEnv({ ANTHROPIC_API_KEY: "k", PATH: "/b" } as NodeJS.ProcessEnv, { home: "/h", tmpdir: "/t" });
    expect("ANTHROPIC_BASE_URL" in env).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run test/runner/provision.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/runner/provision.ts
/** Builds the runner subprocess env from an explicit allowlist — never a filtered process.env, so no GEODE_* secret can leak. */
export function buildRunnerEnv(source: NodeJS.ProcessEnv, opts: { home: string; tmpdir: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: source.PATH,
    HOME: opts.home,
    TMPDIR: opts.tmpdir,
  };
  if (source.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = source.ANTHROPIC_API_KEY;
  if (source.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = source.ANTHROPIC_BASE_URL;
  return env;
}
```

- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** — `git add src/runner/provision.ts test/runner/provision.test.ts && git commit -m "feat(runner): env allowlist (drops GEODE_* secrets from the runner)"`

---

## Task 3: Privilege resolution (root pre-flight → uid/gid or loud fallback)

**Files:**
- Modify: `src/runner/provision.ts`, `test/runner/provision.test.ts`

**Interfaces:**
- Produces: `resolveRunnerPrivilege(config: { runnerUid?: number; runnerGid?: number }, getuid: () => number | undefined): { uid?: number; gid?: number; mode: "dropped" | "same-uid"; reason?: string }`.
  - Returns `{ uid, gid, mode: "dropped" }` only when `getuid() === 0` AND `config.runnerUid` is set.
  - Otherwise `{ mode: "same-uid", reason }` (reason: `"not running as root"` or `"no runner uid configured"`), and NO uid/gid.

- [ ] **Step 1: Write the failing test** (append to `test/runner/provision.test.ts`)

```ts
import { resolveRunnerPrivilege } from "../../src/runner/provision.js";

describe("resolveRunnerPrivilege", () => {
  it("drops to the configured uid/gid when root", () => {
    expect(resolveRunnerPrivilege({ runnerUid: 1001, runnerGid: 1002 }, () => 0))
      .toEqual({ uid: 1001, gid: 1002, mode: "dropped" });
  });
  it("falls back to same-uid when not root", () => {
    const r = resolveRunnerPrivilege({ runnerUid: 1001, runnerGid: 1002 }, () => 501);
    expect(r.mode).toBe("same-uid");
    expect(r.uid).toBeUndefined();
    expect(r.reason).toMatch(/root/);
  });
  it("falls back to same-uid when no runner uid configured (even as root)", () => {
    const r = resolveRunnerPrivilege({}, () => 0);
    expect(r.mode).toBe("same-uid");
    expect(r.reason).toMatch(/configured/);
  });
  it("treats undefined getuid (non-POSIX) as non-root", () => {
    expect(resolveRunnerPrivilege({ runnerUid: 1001 }, () => undefined).mode).toBe("same-uid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (export missing).

- [ ] **Step 3: Implement** (append to `src/runner/provision.ts`)

```ts
/** Decides whether to drop the runner to a low-priv uid/gid: only when the broker is root AND a runner uid is configured; otherwise a same-uid fallback with a reason. */
export function resolveRunnerPrivilege(
  config: { runnerUid?: number; runnerGid?: number },
  getuid: () => number | undefined,
): { uid?: number; gid?: number; mode: "dropped" | "same-uid"; reason?: string } {
  if (getuid() !== 0) return { mode: "same-uid", reason: "not running as root" };
  if (config.runnerUid === undefined) return { mode: "same-uid", reason: "no runner uid configured (set GEODE_RUNNER_UID)" };
  return { uid: config.runnerUid, gid: config.runnerGid, mode: "dropped" };
}
```

- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** — `git add src/runner/provision.ts test/runner/provision.test.ts && git commit -m "feat(runner): privilege resolution with loud same-uid fallback"`

---

## Task 4: `provisionRunner` + wire into the kernel

**Files:**
- Modify: `src/runner/provision.ts` (add `provisionRunner`), `test/runner/provision.test.ts`
- Modify: `src/index.ts:71-77`

**Interfaces:**
- Consumes: `buildRunnerEnv`, `resolveRunnerPrivilege` (Tasks 2-3); `Config` (Task 1).
- Produces: `provisionRunner(config: Config, deps: { getuid: () => number | undefined; log: (m: string) => void; ensureDir: (p: string) => void }): { cwd: string; env: NodeJS.ProcessEnv; uid?: number; gid?: number }`.
  It resolves privilege, builds the allowlist env with `home: config.runnerHome` + a runner tmpdir (`join(config.runnerHome, "tmp")`), ensures both dirs exist, logs the mode loudly (`"[runner] privilege: dropped to uid 1001"` or `"[runner] privilege: SAME-UID (not running as root) — no trust boundary; dev only"`), and returns the spawn options fragment (without `cwd` from the caller — the caller adds `cwd: pkgRoot`). Actually it returns `cwd` too: set to the caller-provided `pkgRoot`. To keep it testable, take `pkgRoot` as a field on `deps`.

  Final signature: `provisionRunner(config, deps: { pkgRoot: string; getuid; log; ensureDir }): { cwd: string; env; uid?; gid? }`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { provisionRunner } from "../../src/runner/provision.js";

describe("provisionRunner", () => {
  const cfg = { runnerHome: "/rh", runnerUid: 1001, runnerGid: 1002 } as any;
  it("returns dropped uid + scrubbed env + ensures dirs + logs when root", () => {
    const dirs: string[] = []; const logs: string[] = [];
    const out = provisionRunner({ ...cfg }, {
      pkgRoot: "/pkg", getuid: () => 0, log: (m) => logs.push(m), ensureDir: (p) => dirs.push(p),
      source: { ANTHROPIC_API_KEY: "k", PATH: "/b", GEODE_SECRETS_KEY: "M" } as any,
    });
    expect(out.uid).toBe(1001);
    expect(out.cwd).toBe("/pkg");
    expect(out.env.HOME).toBe("/rh");
    expect(Object.keys(out.env).some((k) => k.startsWith("GEODE_"))).toBe(false);
    expect(dirs).toContain("/rh");
    expect(logs.join(" ")).toMatch(/dropped to uid 1001/);
  });
  it("same-uid + loud warning when not root", () => {
    const logs: string[] = [];
    const out = provisionRunner({ ...cfg }, {
      pkgRoot: "/pkg", getuid: () => 501, log: (m) => logs.push(m), ensureDir: () => {},
      source: { ANTHROPIC_API_KEY: "k", PATH: "/b" } as any,
    });
    expect(out.uid).toBeUndefined();
    expect(logs.join(" ")).toMatch(/SAME-UID/);
  });
});
```

(Note: the test passes a `source` env on `deps`; make `deps.source` an injectable stand-in for `process.env` so the helper is pure/testable.)

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** (append to `src/runner/provision.ts`)

```ts
import { join } from "node:path";
import type { Config } from "../config.js";

/** Assembles the runner spawn options — scrubbed env + optional uid/gid drop — ensuring the runner HOME/TMPDIR exist and logging the trust-boundary mode loudly. */
export function provisionRunner(
  config: Config,
  deps: { pkgRoot: string; getuid: () => number | undefined; log: (m: string) => void; ensureDir: (p: string) => void; source: NodeJS.ProcessEnv },
): { cwd: string; env: NodeJS.ProcessEnv; uid?: number; gid?: number } {
  const tmpdir = join(config.runnerHome, "tmp");
  deps.ensureDir(config.runnerHome);
  deps.ensureDir(tmpdir);
  const env = buildRunnerEnv(deps.source, { home: config.runnerHome, tmpdir });
  const priv = resolveRunnerPrivilege(config, deps.getuid);
  if (priv.mode === "dropped") deps.log(`[runner] privilege: dropped to uid ${priv.uid} gid ${priv.gid ?? "(default)"}`);
  else deps.log(`[runner] privilege: SAME-UID (${priv.reason}) — no trust boundary between broker and agent; dev only`);
  return { cwd: deps.pkgRoot, env, uid: priv.uid, gid: priv.gid };
}
```

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Wire into `src/index.ts`** — replace `spawnOptions: { cwd: pkgRoot, env: process.env }` (line 76) with:

```ts
import { mkdirSync } from "node:fs";
import { provisionRunner } from "./runner/provision.js";
// ...inside main(), before queryDeps:
const runnerSpawn = provisionRunner(config, {
  pkgRoot, getuid: () => process.getuid?.(), log: (m) => console.warn(m),
  ensureDir: (p) => mkdirSync(p, { recursive: true }), source: process.env,
});
// ...then:
    engine: createSubprocessEngine({
      runnerCommand: process.execPath,
      runnerArgs: ["--import", "tsx", runnerEntry],
      spawnOptions: runnerSpawn,
    }),
```

Update the comment block at `index.ts:68-70` to say the env is now scrubbed to an allowlist and uid is dropped when privileged.

- [ ] **Step 6: Verify** — `npm run typecheck` clean; `npx vitest run` green.

- [ ] **Step 7: Live re-check on this (non-root) host** — the runner now gets the SCRUBBED env (no `GEODE_*`). Confirm a real run still works: start the kernel (`npx tsx --env-file=.env src/index.ts`), watch stderr for `[runner] privilege: SAME-UID (not running as root)…`, then via the dashboard run a simple instruction that writes a file, and confirm it streams + commits. (Proves the allowlist env — `ANTHROPIC_API_KEY` + `PATH` + runner HOME/TMPDIR — is sufficient for the SDK.) Record the outcome.

- [ ] **Step 8: Commit** — `git add src/runner/provision.ts test/runner/provision.test.ts src/index.ts && git commit -m "feat(runner): scrub env + drop uid when privileged (same-uid fallback on dev)"`

---

## Task 5: OS provisioning + adversarial Docker harness

**Files:**
- Create: `Dockerfile`, `scripts/verify-uid-boundary.ts`, `.agent/SOP/verify-uid-boundary.md`

This task is **Linux/Docker and partly manual** (no CI exists). Its deliverable is a reproducible proof, on a privileged Linux host, that the uid boundary is real. The TDD unit cycle does not apply; the verification IS the test.

**Objective 1 — the ownership model (documented + scripted).** The deploy provisioning must, on a privileged Linux host:
- create a shared group `geode-rw` and a runner user (`geode-runner`, its uid = `GEODE_RUNNER_UID`), with the broker user also in `geode-rw`;
- `chgrp -R geode-rw <workspaceRoot>` and `chmod -R 2770` (setgid) it; the broker (and the kernel it launches) run with `umask 002` so runner-created files/dirs stay group-writable — proven for **nested** dirs, not just top-level;
- `chmod 0700 <secretsDir>` (broker-owned) — covers `secrets.enc`, the AES `key`, and the `sign`/`oauth`/`session`/`link` subkeys;
- make `~/.geode` itself traversable (`0711`) and `~/.geode/uploads` group-readable by the runner, while `~/.geode/{transcripts,tools}` and the account files stay `0700` broker-only;
- create `runnerHome` owned by the runner user.

**Objective 2 — `scripts/verify-uid-boundary.ts`** (API-key-free, filesystem-deterministic — mirrors the assertion style of `scripts/verify-sandbox.ts`, no LLM):
- As the (root) broker, write a sentinel into `<secretsDir>/secrets.enc` and a file into the vault.
- Spawn a trivial child with `spawn(process.execPath, [probe], { uid: RUNNER_UID, gid: RUNNER_GID })` where `probe` attempts `readFileSync(secretsEnc)` and `readFileSync(vaultFile)` and writes a new file into the vault, reporting each result.
- **Assert:** reading `secrets.enc` fails with `EACCES`; reading a staged `uploads` file succeeds; writing into the vault succeeds; and afterward the broker can `git add`+`commit` the runner-written file (`reset --hard`/`clean -fd` also succeed on runner-created nested dirs).
- Exit non-zero on any assertion failure so a human `docker run` gives a clear pass/fail.

**Objective 3 — `Dockerfile`** (`node:20-bookworm`): `apt-get install -y bubblewrap socat` (the SDK sandbox needs bubblewrap; per-host egress needs socat — per `.agent/SOP/verify-sandbox.md`), `groupadd geode-rw`, `useradd` the broker + `geode-runner` users, copy the repo + `npm ci`, and default to running `scripts/verify-uid-boundary.ts` as the root broker.

- [ ] **Step 1:** Write `scripts/verify-uid-boundary.ts` per Objective 2.
- [ ] **Step 2:** Write the `Dockerfile` per Objective 3.
- [ ] **Step 3:** Write `.agent/SOP/verify-uid-boundary.md` documenting the ownership model (Objective 1) and the exact `docker build -t geode-uidcheck . && docker run --rm geode-uidcheck` command + expected output.
- [ ] **Step 4: Run it** — `docker build` + `docker run` on the host (this Mac has Docker per the existing `test:docker` gate). Confirm the harness prints the EACCES-on-secrets + vault-write-and-commit success and exits 0. **Record the actual output** — this is the proof the boundary is real on Linux.
- [ ] **Step 5: Commit** — `git add Dockerfile scripts/verify-uid-boundary.ts .agent/SOP/verify-uid-boundary.md && git commit -m "test(security): adversarial uid-boundary Docker harness"`

---

## Final verification

- [ ] `npm run typecheck` — green.
- [ ] `npx vitest run` — green (config, provision unit tests, plus untouched suites).
- [ ] `npm run lint` — green.
- [ ] Task 4 Step 7 recorded: a real run on this non-root host works with the scrubbed env + same-uid fallback (loud log observed).
- [ ] Task 5 Step 4 recorded: the Docker harness proves, on a privileged Linux host, that the runner uid gets `EACCES` on `secrets.enc` while it can write + get its vault committed.
- [ ] Update `.agent/System/security-model.md`: the runner→broker boundary is now a **trust boundary when privileged** (uid drop + allowlist env + `0700` secrets), with a documented same-uid dev fallback; cite `src/runner/provision.ts`. Note holes A/B are closed **on a privileged host** (the runner can no longer read `secrets.enc` or the master key from env); hole C (agent egress) remains for slice 1B-2.

## Next: slice 1B-2

With the runner isolated, slice 1B-2 adds Layer 2 — the fetch/process role split (a network-broad, no-vault "fetcher" writing to staging; a vault-write, model-host-only "librarian" reading it) via per-role `allowedDomains` on the sandbox settings that already cross the pipe.

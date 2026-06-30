# CLI/repo executor — Docker sandbox (#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `cli`/repo tools install (owner-gated Docker image build) and run (a fresh sandboxed container per `invoke`, creds injected at runtime), safely by default.

**Architecture:** A thin injectable `Docker` wrapper + PURE arg-builders (Dockerfile text + `docker run` flags) so the logic is unit-testable with a stubbed Docker; the real Docker path is integration-tested behind a Docker-required gate. `invoke`'s `cli` branch (currently an inert error) calls the sandbox runner. Install is owner-explicit (dashboard/CLI) with a permissions review; the caller only runs already-installed tools.

**Tech Stack:** TypeScript ESM, `node:child_process` (spawn `docker`), vitest, the existing `tools.ts`/`invoke.ts`/dashboard from #2a.

**Spec:** `docs/superpowers/specs/2026-06-30-cli-executor-sandbox-design.md`

**Branch:** `feat/tool-executor-3`. Husky gate requires JSDoc on exports. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File map

| File | Change |
|---|---|
| `src/tools.ts` | extend `ToolManifest` with `image` / `permissions` / `limits` |
| `src/docker.ts` | **new** — pure `buildDockerfile`/`runArgs` + the `Docker` interface + `realDocker()` |
| `src/installer.ts` | **new** — install state (`~/.geode/tools/<id>/installed.json`), `installTool`, `uninstallTool`, `readInstallState` |
| `src/sandboxRun.ts` | **new** — `runCliTool` (run an installed cli action in a container → `InvokeResult`) |
| `src/invoke.ts` | replace the `cli` inert branch with `runCliTool`; thread the new deps |
| `src/server.ts`, `src/index.ts` | construct + pass the `docker` + `toolsDir` deps into `invoke` |
| `src/egressProxy.ts` | **new** — minimal allowlisting forward-proxy for `network: [hosts]` |
| `src/toolCli.ts` | **new** — `npm run tool -- install/uninstall <id>` |
| `src/dashboard/ops.ts`, `api.ts` | install-state in `ToolView`; `/tools/:id/install` + `/uninstall` routes |
| `web/src/api.ts`, `views/Tools.tsx` | "Install & trust" + permissions review + installed status |
| `package.json` | `tool` script |
| tests | `test/docker.test.ts`, `test/installer.test.ts`, `test/sandboxRun.test.ts`, `test/integration/cliExecutor.docker.test.ts` |

---

## Phase 1 — manifest type

### Task 1: extend `ToolManifest`

**Files:** Modify `src/tools.ts`; Test `test/tools.test.ts` (add a case).

`loadTool` spreads `...fm`, so new frontmatter fields flow through automatically — only the TYPE needs extending.

- [ ] **Step 1: add the failing test** — append to `test/tools.test.ts`:
```ts
test("loadTool parses image, permissions and limits", async () => {
  const root = vault();
  writeTool(root, "cb", `---
id: cb
name: CB
type: cli
description: d
image: { base: "node:20-slim" }
permissions: { network: ["*.cloak.com"] }
limits: { timeoutMs: 30000, memoryMb: 256 }
source: { repo: "https://github.com/x/cb", ref: "v1" }
install: ["npm ci"]
bin: "./cb"
actions: { fetch: { command: "fetch --url \${params.url}", params: [{ name: url, required: true }] } }
---
`);
  const t = await loadTool(root, "cb");
  expect(t.image?.base).toBe("node:20-slim");
  expect(t.permissions?.network).toEqual(["*.cloak.com"]);
  expect(t.limits?.timeoutMs).toBe(30000);
});
```
(Use the existing `vault()`/`writeTool` helpers in that file.)

- [ ] **Step 2: run → FAIL** (`npx vitest run test/tools.test.ts`) — type error / undefined fields.

- [ ] **Step 3: extend the type** — in `src/tools.ts` `ToolManifest`, add after `bin?: string;`:
```ts
  image?: { base: string };
  permissions?: { network?: "none" | "any" | string[]; filesystem?: string[] };
  limits?: { timeoutMs?: number; memoryMb?: number; cpus?: number };
```

- [ ] **Step 4: run → PASS**; **Step 5: commit**
```bash
git add src/tools.ts test/tools.test.ts
git commit -m "feat(tools): manifest image/permissions/limits fields for the cli executor"
```

---

## Phase 2 — Docker abstraction (pure builders + wrapper)

### Task 2: pure Dockerfile + run-arg builders (TDD)

**Files:** Create `src/docker.ts`, `test/docker.test.ts`.

- [ ] **Step 1: failing test** — `test/docker.test.ts`:
```ts
import { test, expect } from "vitest";
import { buildDockerfile, runArgs, imageTag } from "../src/docker.js";
import type { ToolManifest } from "../src/tools.js";

const M: ToolManifest = {
  id: "cb", name: "CB", type: "cli", description: "d",
  image: { base: "node:20-slim" },
  source: { repo: "https://github.com/x/cb", ref: "v1" },
  install: ["npm ci", "npm run build"], bin: "./cb",
  actions: { fetch: { command: "fetch --url x" } },
};

test("imageTag is per id+ref", () => {
  expect(imageTag(M)).toBe("geode-tool/cb:v1");
});

test("buildDockerfile clones the pinned ref and runs install in the image", () => {
  const df = buildDockerfile(M);
  expect(df).toContain("FROM node:20-slim");
  expect(df).toContain("git clone");
  expect(df).toContain("v1");
  expect(df).toContain("RUN npm ci");
  expect(df).toContain("RUN npm run build");
  expect(df).not.toContain("${"); // no unresolved secrets ever in the image
});

test("runArgs builds a locked-down docker run argv", () => {
  const args = runArgs({ tag: "geode-tool/cb:v1", command: ["./cb", "fetch", "--url", "x"], envFile: "/tmp/e", network: "none", memoryMb: 256, cpus: 1, timeoutMs: 30000 });
  expect(args).toContain("run");
  expect(args).toContain("--rm");
  expect(args).toContain("--network"); expect(args).toContain("none");
  expect(args).toContain("--read-only");
  expect(args).toContain("--env-file"); expect(args).toContain("/tmp/e");
  expect(args).toContain("--memory"); expect(args).toContain("256m");
  expect(args).toContain("geode-tool/cb:v1");
  expect(args.slice(args.indexOf("geode-tool/cb:v1") + 1)).toEqual(["./cb", "fetch", "--url", "x"]);
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement `src/docker.ts`** (pure parts + the wrapper interface):
```ts
import { spawn } from "node:child_process";
import type { ToolManifest } from "./tools.js";

/** The cached image tag for a tool, keyed by id + pinned ref. */
export function imageTag(m: ToolManifest): string { return `geode-tool/${m.id}:${m.source?.ref ?? "latest"}`; }

/** Generates the Dockerfile that clones the pinned source and bakes the install — no secrets ever. */
export function buildDockerfile(m: ToolManifest): string {
  const base = m.image?.base ?? "node:20-slim";
  const lines = [`FROM ${base}`, "WORKDIR /tool"];
  if (m.source?.repo) {
    const ref = m.source.ref ? ` --branch ${m.source.ref}` : "";
    lines.push(`RUN git clone --depth 1${ref} ${m.source.repo} .`);
  } else if (m.source?.package) {
    lines.push(`RUN ${m.source.package.startsWith("pip:") ? `pip install ${m.source.package.slice(4)}` : `npm install -g ${m.source.package.replace(/^npm:/, "")}`}`);
  }
  for (const cmd of m.install ?? []) lines.push(`RUN ${cmd}`);
  return lines.join("\n") + "\n";
}

/** Options for a single sandboxed run. */
export interface RunOpts { tag: string; command: string[]; envFile: string; network: "none" | "bridge"; memoryMb?: number; cpus?: number; timeoutMs?: number }

/** Builds the locked-down `docker run` argv (read-only rootfs, no mounts, env-file creds, limits). */
export function runArgs(o: RunOpts): string[] {
  const a = ["run", "--rm", "--read-only", "--network", o.network, "--env-file", o.envFile];
  if (o.memoryMb) a.push("--memory", `${o.memoryMb}m`);
  if (o.cpus) a.push("--cpus", String(o.cpus));
  a.push(o.tag, ...o.command);
  return a;
}

/** Result of a finished container run. */
export interface RunResult { exitCode: number; stdout: string; stderr: string }
/** Injectable Docker side-effects (stubbed in unit tests, real in integration). */
export interface Docker {
  available(): Promise<boolean>;
  imageExists(tag: string): Promise<boolean>;
  build(tag: string, dockerfile: string): Promise<void>;
  run(args: string[], timeoutMs?: number): Promise<RunResult>;
  removeImage(tag: string): Promise<void>;
}

const sh = (cmd: string, args: string[], input?: string, timeoutMs?: number): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = timeoutMs ? setTimeout(() => { p.kill("SIGKILL"); }, timeoutMs) : null;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }); });
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
  });

/** The real Docker wrapper, spawning the `docker` CLI. */
export function realDocker(): Docker {
  return {
    async available() { try { return (await sh("docker", ["version", "--format", "{{.Server.Version}}"]))​.exitCode === 0; } catch { return false; } },
    async imageExists(tag) { return (await sh("docker", ["image", "inspect", tag])).exitCode === 0; },
    async build(tag, dockerfile) { const r = await sh("docker", ["build", "-t", tag, "-f", "-", "."], dockerfile); if (r.exitCode !== 0) throw new Error(`docker build failed: ${r.stderr.slice(-800)}`); },
    async run(args, timeoutMs) { return sh("docker", args, undefined, timeoutMs); },
    async removeImage(tag) { await sh("docker", ["rmi", "-f", tag]); },
  };
}
```
(If the `​` zero-width char appears in `available()`, remove it — write `(await sh(...)).exitCode === 0`.)

- [ ] **Step 4: run → PASS**; **Step 5: commit**
```bash
git add src/docker.ts test/docker.test.ts
git commit -m "feat(docker): pure Dockerfile/run-arg builders + Docker wrapper"
```

---

## Phase 3 — installer (TDD, stubbed Docker)

### Task 3: install state + installTool/uninstallTool

**Files:** Create `src/installer.ts`, `test/installer.test.ts`.

Install builds the image, smoke-runs it, and records `installed.json` (image tag, ref, approved permissions, timestamp). The owner-approval is represented by the caller passing the approved permissions in (the dashboard/CLI gather consent — Tasks 7–8).

- [ ] **Step 1: failing test** — `test/installer.test.ts`:
```ts
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installTool, readInstallState, uninstallTool } from "../src/installer.js";
import type { Docker } from "../src/docker.js";

function vault(id: string, md: string) { const root = mkdtempSync(join(tmpdir(), "ge-")); mkdirSync(join(root, "tools", id), { recursive: true }); writeFileSync(join(root, "tools", id, "TOOL.md"), md); return root; }
const MD = `---
id: cb
name: CB
type: cli
description: d
image: { base: "node:20-slim" }
source: { repo: "https://github.com/x/cb", ref: "v1" }
bin: "./cb"
actions: { fetch: { command: "fetch" } }
---`;
function fakeDocker(over: Partial<Docker> = {}): Docker {
  return { available: async () => true, imageExists: async () => false, build: async () => {}, run: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }), removeImage: async () => {}, ...over };
}

test("installTool builds, smoke-runs, and records state", async () => {
  const root = vault("cb", MD);
  const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  let built = "";
  const docker = fakeDocker({ build: async (tag) => { built = tag; } });
  const state = await installTool({ root, toolsDir, docker }, "cb", { network: "none" });
  expect(built).toBe("geode-tool/cb:v1");
  expect(state.image).toBe("geode-tool/cb:v1");
  expect((await readInstallState(toolsDir, "cb"))?.image).toBe("geode-tool/cb:v1");
});

test("installTool fails (and records nothing) when smoke run exits non-zero", async () => {
  const root = vault("cb", MD);
  const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  const docker = fakeDocker({ run: async () => ({ exitCode: 1, stdout: "", stderr: "boom" }) });
  await expect(installTool({ root, toolsDir, docker }, "cb", { network: "none" })).rejects.toThrow(/smoke/);
  expect(await readInstallState(toolsDir, "cb")).toBeNull();
});

test("installTool refuses when Docker is unavailable", async () => {
  const root = vault("cb", MD); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await expect(installTool({ root, toolsDir, docker: fakeDocker({ available: async () => false }) }, "cb", { network: "none" })).rejects.toThrow(/Docker/);
});

test("uninstallTool removes the image + state", async () => {
  const root = vault("cb", MD); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await installTool({ root, toolsDir, docker: fakeDocker() }, "cb", { network: "none" });
  await uninstallTool({ toolsDir, docker: fakeDocker() }, "cb");
  expect(await readInstallState(toolsDir, "cb")).toBeNull();
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement `src/installer.ts`:**
```ts
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadTool } from "./tools.js";
import { imageTag, buildDockerfile, runArgs, type Docker } from "./docker.js";

/** Persisted record that a tool is installed. */
export interface InstallState { id: string; image: string; ref?: string; permissions: { network?: unknown }; approvedAt: string }

const statePath = (toolsDir: string, id: string) => join(toolsDir, id, "installed.json");

/** Reads a tool's install state, or null if not installed. */
export async function readInstallState(toolsDir: string, id: string): Promise<InstallState | null> {
  try { return JSON.parse(await readFile(statePath(toolsDir, id), "utf8")) as InstallState; } catch { return null; }
}

/** Builds the tool's image, smoke-runs it, and records install state. `approvedPermissions` = the owner-approved perms. */
export async function installTool(deps: { root: string; toolsDir: string; docker: Docker }, id: string, approvedPermissions: { network?: unknown }): Promise<InstallState> {
  if (!(await deps.docker.available())) throw new Error("Docker is required to install a cli/repo tool, and it is not available. Install + start Docker, then retry.");
  const m = await loadTool(deps.root, id);
  if (m.type !== "cli") throw new Error(`tool ${id} is not a cli tool`);
  const tag = imageTag(m);
  await deps.docker.build(tag, buildDockerfile(m));
  // smoke: run the bin with no args (must exit 0). `--network none`, no creds.
  const smoke = await deps.docker.run(runArgs({ tag, command: m.bin ? [m.bin] : [], envFile: "/dev/null", network: "none", timeoutMs: 30000 }), 30000);
  if (smoke.exitCode !== 0) throw new Error(`smoke run failed for ${id} (exit ${smoke.exitCode}): ${smoke.stderr.slice(-400)}`);
  const state: InstallState = { id, image: tag, ref: m.source?.ref, permissions: approvedPermissions, approvedAt: new Date().toISOString() };
  await mkdir(join(deps.toolsDir, id), { recursive: true });
  await writeFile(statePath(deps.toolsDir, id), JSON.stringify(state, null, 2));
  return state;
}

/** Removes a tool's image + install state. */
export async function uninstallTool(deps: { toolsDir: string; docker: Docker }, id: string): Promise<void> {
  const st = await readInstallState(deps.toolsDir, id);
  if (st) await deps.docker.removeImage(st.image);
  if (existsSync(statePath(deps.toolsDir, id))) await rm(statePath(deps.toolsDir, id));
}
```
Note: `new Date()` is fine here (normal Node, not a Workflow script).

- [ ] **Step 4: run → PASS**; **Step 5: commit**
```bash
git add src/installer.ts test/installer.test.ts
git commit -m "feat(installer): build/smoke/record install state for cli tools (Docker-gated)"
```

---

## Phase 4 — sandboxed run + invoke wiring

### Task 4: runCliTool (TDD, stubbed Docker)

**Files:** Create `src/sandboxRun.ts`, `test/sandboxRun.test.ts`.

- [ ] **Step 1: failing test** — `test/sandboxRun.test.ts`:
```ts
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTool } from "../src/sandboxRun.js";
import { installTool } from "../src/installer.js";
import type { Docker } from "../src/docker.js";

const MD = `---
id: cb
name: CB
type: cli
description: d
image: { base: b }
requires: [TOKEN]
connections: [{ label: default }]
permissions: { network: none }
bin: "./cb"
actions: { fetch: { command: "fetch --url \${params.url}" } }
---`;
function vault() { const root = mkdtempSync(join(tmpdir(), "ge-")); mkdirSync(join(root, "tools", "cb"), { recursive: true }); writeFileSync(join(root, "tools", "cb", "TOOL.md"), MD); return root; }
const docker = (over: Partial<Docker> = {}): Docker => ({ available: async () => true, imageExists: async () => true, build: async () => {}, run: async () => ({ exitCode: 0, stdout: '{"ok":true}', stderr: "" }), removeImage: async () => {}, ...over });
const secrets = (m: Record<string,string>) => ({ get: async (r: string) => m[r] ?? null });

test("runCliTool runs the action's command in a fresh container and returns stdout+exit", async () => {
  const root = vault(); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await installTool({ root, toolsDir, docker: docker() }, "cb", { network: "none" });
  let ranArgs: string[] = [];
  const d = docker({ run: async (args) => { ranArgs = args; return { exitCode: 0, stdout: '{"ok":true}', stderr: "" }; } });
  const r = await runCliTool({ root, toolsDir, docker: d, secrets: secrets({ "cb__default__TOKEN": "sek" }) }, "cb", "fetch", { url: "https://x" }, "default");
  expect(r).toEqual({ status: 0, body: { ok: true } });
  expect(ranArgs).toContain("--network"); expect(ranArgs).toContain("none");
  // command resolved
  expect(ranArgs.join(" ")).toContain("fetch --url https://x");
});

test("runCliTool errors when the tool is not installed", async () => {
  const root = vault(); const toolsDir = mkdtempSync(join(tmpdir(), "ge-tools-"));
  await expect(runCliTool({ root, toolsDir, docker: docker(), secrets: secrets({}) }, "cb", "fetch", {}, "default")).rejects.toThrow(/must install/);
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement `src/sandboxRun.ts`:**
```ts
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SecretStore } from "./secrets.js";
import type { Docker } from "./docker.js";
import { loadTool, resolveTemplate, resolveConnection, loadConnBundle } from "./tools.js";
import { imageTag, runArgs } from "./docker.js";
import { readInstallState } from "./installer.js";
import type { InvokeResult } from "./invoke.js";

/** Runs one action of an installed cli tool in a fresh sandboxed container; returns exit-code + parsed stdout. */
export async function runCliTool(
  deps: { root: string; toolsDir: string; docker: Docker; secrets: Pick<SecretStore, "get"> },
  toolId: string, actionName: string, params: Record<string, unknown>, connection?: string,
): Promise<InvokeResult> {
  const m = await loadTool(deps.root, toolId);
  if (!(await readInstallState(deps.toolsDir, toolId))) throw new Error(`tool "${toolId}" is not installed — the owner must install it first`);
  if (m.materialize && m.materialize.inject === "profile") throw new Error(`profile-dir credentials are not supported yet (#4)`);
  const action = m.actions[actionName];
  if (!action?.command) throw new Error(`unknown cli action "${actionName}" on "${toolId}"`);
  const label = resolveConnection(m.connections ?? [], connection);
  const conn = await loadConnBundle(deps.secrets, toolId, label, m.requires ?? []);
  const command = resolveTemplate(`${m.bin ? m.bin + " " : ""}${action.command}`, { params, conn });
  const env = m.materialize?.env ? Object.fromEntries(Object.entries(m.materialize.env).map(([k, v]) => [k, resolveTemplate(v, { params, conn })])) : conn;
  const network = m.permissions?.network && m.permissions.network !== "none" ? "bridge" : "none";
  const dir = await mkdtemp(join(tmpdir(), "geode-env-"));
  const envFile = join(dir, "env");
  await writeFile(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"), { mode: 0o600 });
  try {
    const r = await deps.docker.run(runArgs({ tag: imageTag(m), command: command.split(/\s+/), envFile, network, memoryMb: m.limits?.memoryMb ?? 512, cpus: m.limits?.cpus ?? 1, timeoutMs: m.limits?.timeoutMs ?? 60000 }), m.limits?.timeoutMs ?? 60000);
    let body: unknown = r.stdout; try { body = JSON.parse(r.stdout); } catch { /* keep text */ }
    return { status: r.exitCode, body };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
```
(Note: v1 network is coarse — `none` vs `bridge`; the egress-proxy allowlist lands in Task 6.)

- [ ] **Step 4: run → PASS.**

- [ ] **Step 5: wire `invoke.ts` + deps** — in `src/invoke.ts`: add `toolsDir?: string; docker?: import("./docker.js").Docker` to the `deps` param; replace line 20's cli/mcp branch with:
```ts
  if (manifest.type === "mcp") throw new Error("executor 'mcp' not available yet (slice #3b)");
  if (manifest.type === "cli") {
    if (!deps.toolsDir || !deps.docker) throw new Error("cli executor not configured");
    const { runCliTool } = await import("./sandboxRun.js");
    return runCliTool({ root: deps.root, toolsDir: deps.toolsDir, docker: deps.docker, secrets: deps.secrets }, args.tool, args.action, params, args.connection);
  }
```
In `src/index.ts`, where `invoke` is wired (`invoke: (args) => invoke({ root: workspace.root, secrets }, args)`), add `toolsDir` + `docker`: import `realDocker` from `./docker.js`, compute `toolsDir = join(homedir(), ".geode", "tools")` (or from config), and pass `{ root: workspace.root, secrets, toolsDir, docker: realDocker() }`. Do the same for the dashboard `invoke` dep wiring.

- [ ] **Step 6: full suite + commit**

Run `npm test` (all green — the cli inert-error test in `test/invoke.test.ts` now expects the new behavior; update that one assertion: an unconfigured cli invoke now throws `/not configured/` OR, with deps, `/must install/`). Run `npm run typecheck`.
```bash
git add src/sandboxRun.ts test/sandboxRun.test.ts src/invoke.ts src/index.ts test/invoke.test.ts
git commit -m "feat(invoke): run installed cli tools in a fresh sandboxed container"
```

---

## Phase 5 — owner surfaces (CLI + dashboard) + egress proxy

### Task 5: `tool` CLI (`install`/`uninstall`)

**Files:** Create `src/toolCli.ts`; Modify `package.json`.

- [ ] **Step 1** — read `src/secretCli.ts` to mirror its structure (loadConfig, store wiring). Create `src/toolCli.ts` with a `main()` that dispatches `install <id>` / `uninstall <id>`: builds `realDocker()`, computes `toolsDir`, loads the manifest, prints the requested `permissions` and asks the owner to confirm on stdin (the permissions-review gate), then calls `installTool`/`uninstallTool`. Print the result.
- [ ] **Step 2** — add to `package.json` scripts: `"tool": "tsx src/toolCli.ts"`.
- [ ] **Step 3** — `npm run typecheck` clean; commit.
```bash
git add src/toolCli.ts package.json && git commit -m "feat(cli): tool install/uninstall with a permissions-review prompt"
```

### Task 6: egress proxy for `network: [allowlist]`

**Files:** Create `src/egressProxy.ts`, `test/egressProxy.test.ts`; Modify `src/sandboxRun.ts`.

- [ ] Implement a minimal HTTP(S) CONNECT forward-proxy that only allows the manifest's declared hosts (glob match), bound to localhost. In `runCliTool`, when `permissions.network` is a host array: start the proxy (allowlist = those hosts), run the container on a network that can reach it with `HTTP_PROXY`/`HTTPS_PROXY` env pointing at it, stop the proxy after. TDD the **allowlist match** as a pure function (`hostAllowed(host, patterns)`), the proxy wiring as integration. Keep `none` (no proxy) and `any` (bridge, loud) paths.
- [ ] Unit-test `hostAllowed`; commit.
```bash
git add src/egressProxy.ts test/egressProxy.test.ts src/sandboxRun.ts && git commit -m "feat(sandbox): allowlisting egress proxy for declared network permissions"
```

### Task 7: dashboard install/approve/status

**Files:** Modify `src/dashboard/ops.ts`, `src/dashboard/api.ts`, `web/src/api.ts`, `web/src/views/Tools.tsx`.

- [ ] Read the current `src/dashboard/ops.ts` (`ToolView`/`listTools`) and add `installed: boolean` + the approved-permissions to `ToolView` (read via `readInstallState`). Add routes to `src/dashboard/api.ts`: `POST /tools/:id/install` (body: approved — calls `installTool` with the manifest's `permissions`) and `POST /tools/:id/uninstall`. Wire `docker: realDocker()` + `toolsDir` into the dashboard deps (`src/dashboard/index.ts`).
- [ ] Read the current `web/src/views/Tools.tsx` + `web/src/api.ts`; add for `cli` tools: an **Install & trust** button that first shows the declared `permissions` (the review), then POSTs install; an installed/needs-install badge; an uninstall action. Build `web` (`cd web && npm run build`).
- [ ] `npm test` + `npm run typecheck` + web build all green; commit.
```bash
git add src/dashboard web/src package.json && git commit -m "feat(dashboard): install & trust action + installed status for cli tools"
```

---

## Phase 6 — integration test (Docker-gated)

### Task 8: end-to-end with real Docker

**Files:** Create `test/integration/cliExecutor.docker.test.ts`, `test/integration/fixture-tool/` (a trivial repo: a Dockerfile-friendly `cli` that echoes its `--url` arg as JSON).

- [ ] Gate the suite on Docker availability (`describe.skipIf(!dockerPresent)`), excluded from the default `npm test` (a separate `vitest --dir test/integration` or a `test:docker` script). Build a fixture `cli` `TOOL.md` whose `source` is the local fixture dir (or an inline `image.base` + `install` that creates a tiny echo script). Verify end-to-end: `installTool` builds + smoke passes + records state; `runCliTool` returns the echoed JSON with the injected env; `--network none` is enforced (an action that tries to reach the network fails); the temp env-file is removed after; an uninstalled invoke errors.
- [ ] Add `"test:docker": "vitest run test/integration"` to `package.json`. Document in `evals`-style note that it's excluded from CI.
- [ ] Commit.
```bash
git add test/integration package.json && git commit -m "test(cli-executor): Docker-gated end-to-end install + sandboxed run"
```

---

## Self-review notes

- **Spec coverage:** manifest `image`/`permissions`/`limits` (T1) ✓; Docker image-build install + smoke + state + owner-gate (T3, gate prompt T5/T7) ✓; sandboxed run — fresh container, env-file creds, read-only, limits, network none (T4) ✓; egress-proxy allowlist (T6) ✓; `not installed`/`needs Docker`/`profile not supported yet` errors (T3/T4) ✓; invoke `cli` branch swap (T4) ✓; CLI + dashboard surfaces (T5/T7) ✓; Docker-gated integration test + fixture (T8) ✓. Success criteria 1–4 → T3/T7, T4, T3/T4, T2–T4/T8.
- **Out of scope (correctly absent):** mcp-proxy, profile/OAuth, persistent state, raw-socket egress hardening, the #2b authoring agent, the vault-centric dashboard.
- **Green-between:** T4 changes invoke's deps + one existing invoke test assertion (updated in the same task). Dashboard/web land together (T7). Integration test is opt-in (T8), never in the default suite.
- **Pure vs side-effecting:** all logic (Dockerfile/run-arg gen, install/run orchestration, allowlist match) is unit-tested with a stubbed `Docker`; only the real `docker` spawn is integration-tested.

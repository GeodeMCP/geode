# Agent-core sandbox (S1) — design

_Date: 2026-07-01 · Status: approved, pending spec review._

## Problem

The vault curation agent (the engine behind `query` / `remember`) runs **unconfined on the
host**. `src/engine.ts:159-174` builds the Agent SDK options with
`permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true` and the full
`claude_code` tool preset — including `Bash`. Its confinement to the vault is **convention
only** (the constitution says "read/write/bash access within the vault"; `cwd` is the vault),
not enforced. Nothing at the OS level stops the agent from reading/writing/executing anywhere
the host user can.

This is a latent risk today and a concrete one the moment we add **attachments** (D12):
feeding untrusted external files (folders/zips) to an unconfined agent means a single
prompt-injection in an attached file could make the agent do anything on the machine.

It also conflicts with the project's own safety-by-default principle — which today applies to
**tool execution** (cli tools run locked-down in Docker, `src/sandboxRun.ts` / `src/docker.ts`)
but **not** to the agent-core itself.

## Goals / non-goals

**Goals**
- Enforce, at the OS level, that the agent can only **write** inside the vault (+ explicitly
  granted per-run dirs) and only reach an **allowlisted** set of network domains.
- Keep runs **non-interactive** (no permission prompts — the agent can't answer them).
- Keep the **Anthropic Agent SDK** and the current engine; do not rewrite the agent.
- Support a **local model** (configurable LLM endpoint, incl. a loopback gateway).
- Keep **tools + onboarding** working (repo clone / package fetch during onboarding).
- Unblock **D12 attachments** cleanly (attachments outside the vault, granted read-only).

**Non-goals**
- Replacing the agent engine or supporting non-Anthropic-API model wire formats directly
  (a local/other model is reached via an Anthropic-compatible base URL / gateway).
- Sandboxing the cli/http/mcp tools (already done — separate mechanism).
- Eliminating all exfiltration (see Residual risk).

## Design

Use the **Agent SDK's native sandbox** (`sandbox?: SandboxSettings`, SDK v0.3.179) rather than
rolling our own container. It provides OS-level isolation — **bubblewrap** on Linux, **seatbelt**
on macOS (`bwrapPath` / `socatPath` in the settings) — across three axes: filesystem, network,
and command execution. Crucially `autoAllowBashIfSandboxed` runs `bash` sandboxed **without a
prompt**, which fits our non-interactive model, and `bash` (the escape hatch) is therefore
confined by the same OS boundary.

### Filesystem
- `filesystem.allowWrite = [vaultRoot]` (+ per-run attachment dir for D12). **Write is the hard
  boundary** — that's where damage happens.
- **Read stays permissive** (the agent must read broadly — the SDK/runtime, system libs, the
  vault). Reads are not an exfil channel on their own; the network allowlist is what bounds
  exfil. Exact read scope needed for the runtime to function is validated during implementation.
- `.git/` inside the vault is writable (local commits keep working; no network needed for them).

### Network — explicit, configurable allowlist (decision: option A)
- **Default-deny egress.** Allowlist contains:
  1. The **LLM endpoint** — configurable. Default: the Anthropic API host. If
     `ANTHROPIC_BASE_URL` points at a local/gateway endpoint, its host (incl. loopback) is
     allowlisted instead. This is how a **local model** works: run an Anthropic-compatible
     gateway locally, point the base URL at it, and it is auto-added to the allowlist.
  2. **git + package hosts** for tool onboarding (repo clone / inspect) — configurable list
     with safe defaults.
- `WebFetch` / `WebSearch` to arbitrary domains are **off by default** (not on the allowlist);
  widen via config if wanted.
- `allowManagedDomainsOnly` is **rejected** — it would block loopback (local model) and
  onboarding hosts, and hands domain control to a managed set.
- Implemented via the SDK network config (`allowedDomains` + the sandbox proxy); Linux needs
  `socat` alongside `bwrap`.

### Permissions (finalized 2026-07-02)
The initial cut kept `permissionMode: "bypassPermissions"` alongside the sandbox. Review + live
verification proved this **inert**: the SDK derives the sandbox's filesystem/network boundary from
the permission rules, and `bypassPermissions` skips exactly those, while `allowUnsandboxedCommands`
defaults to `true` (Bash can opt out via `dangerouslyDisableSandbox`). The finalized model:

- **Sandbox ON (default/production):** `permissionMode: "default"` + a programmatic `canUseTool`
  handler (`buildPermissionHandler`) that decides every tool call **without prompting** — denying
  `WebFetch`/`WebSearch`, refusing any Bash that sets `dangerouslyDisableSandbox`, and confining
  host-process writes (`Edit`/`Write`/`MultiEdit`/`NotebookEdit`) to the vault (paths canonicalized
  via realpath so symlinks don't cause false denials). `allow` echoes `updatedInput` (SDK requires
  it). The sandbox sets `allowUnsandboxedCommands: false`. **No `bypassPermissions`.**
- **Sandbox OFF (`GEODE_SANDBOX_DISABLE=1`, dev only):** genuinely unconfined — `bypassPermissions`.
- **Invariant:** the engine builds the handler from the sandbox's own `allowWrite`, so
  "sandbox present ⇒ not bypass ⇒ handler attached" is structural, not a convention.
- The vault agent may still ask the user questions in its **chat reply** (answered in the next turn);
  what it must not do is trigger an interactive **tool/MCP** prompt mid-run — hence `canUseTool`
  never returns "ask", `AskUserQuestion` is denied, and no `onElicitation` handler is wired.

### Availability & deploy (fail-closed)
- `sandbox.enabled = true`, `failIfUnavailable = true` — if the sandbox deps are missing, the run
  **fails loudly** rather than silently running unconfined.
- Linux deploy image must ship **bubblewrap + socat**; macOS uses built-in seatbelt.
- A deliberate dev override (`GEODE_SANDBOX_DISABLE=1`) allows running unsandboxed locally, with
  a loud warning. Off by default.

### Configuration surface
- `src/agentSandbox.ts` (new): `resolveSandboxPolicy(env, vaultRoot)` → a resolved policy, and
  `buildSandboxSettings(policy, extraReadDirs?)` → the SDK `sandbox` object. One responsibility:
  translate env/config into SDK sandbox settings. Also exposes an availability check.
- Env: `GEODE_AGENT_ALLOWED_DOMAINS` (comma list, default = git/package hosts),
  `ANTHROPIC_BASE_URL` (LLM endpoint override for local models), `GEODE_SANDBOX_DISABLE` (dev).

### Wiring
- `EngineRunOptions` gains a `sandbox?: SandboxSettings` (resolved, injectable → testable).
- `buildQueryOptions` (`src/engine.ts`) includes `sandbox` and adjusts the permission fields.
- `src/index.ts` resolves the policy once at startup and threads it through `QueryDeps` → the
  engine. Per-run extra read dirs (attachments, D12) are appended by the query layer.

### D12 hook
Attachments stage in a host temp dir **outside** the vault; that dir is appended to
`filesystem.allowRead` for the run. Result: no vault pollution, no commit-UI noise, and the agent
can reach the vault + that one dir only (least privilege). Both earlier objections resolved.

## Data flow (a run)
1. Startup: `resolveSandboxPolicy(env, vaultRoot)` → policy (allowWrite=[vault], allowedDomains,
   enabled, failIfUnavailable).
2. `query()` builds `EngineRunOptions` incl. the sandbox settings (+ any per-run attachment read
   dir).
3. `buildQueryOptions` passes `sandbox` to the SDK; the SDK wraps command/file/network ops in
   bwrap/seatbelt.
4. Agent reads broadly, writes only under the vault, reaches only allowlisted domains; `bash` is
   confined. The kernel commits after the run, as today (host code, outside the sandboxed ops).

## Security posture & residual risk
- **Bounded blast radius:** a prompt-injected agent cannot write outside the vault or exfiltrate
  to non-allowlisted hosts.
- **Residual:** allowlisted hosts still permit *some* exfil (e.g. via an allowed domain). Least
  privilege shrinks the blast radius, it does not eliminate it. A **local model** shrinks it
  further (LLM traffic never leaves the machine).
- Read-permissive means the agent can *read* sensitive host files; without a matching egress
  channel this is low-risk, but tightening read scope is a possible follow-up.

## Testing (acceptance criteria)
- [ ] **Unit:** `resolveSandboxPolicy` / `buildSandboxSettings` map env → correct SDK settings
  (default allowlist; `ANTHROPIC_BASE_URL` override adds the local host; disable flag honoured).
- [ ] **Integration (confinement holds):** a sandboxed run **cannot** write a file outside the
  vault, and **cannot** open a connection to a domain not on the allowlist — both fail; a write
  inside the vault and a call to an allowlisted host succeed.
- [ ] **Non-interactive preserved:** a normal `query` run completes with no permission prompt.
- [ ] **Fail-closed:** with sandbox deps unavailable and no dev override, a run refuses to start
  with a clear error (does not silently run unconfined).
- [ ] **Local-model path:** with `ANTHROPIC_BASE_URL` set to a loopback gateway, the run reaches
  it (loopback allowlisted) and otherwise stays confined.

## Verification (2026-07-02)
Verified live with `scripts/verify-sandbox.ts` — a real sandboxed agent attempting to escape in a
throwaway vault. Results on **macOS (seatbelt)**, repeated across runs:

| Vector | Result |
| --- | --- |
| Bash write outside the vault (`echo > /tmp/…`) | **Blocked** — seatbelt: `operation not permitted` |
| Write **tool** outside the vault | **Blocked** — `canUseTool` deny |
| In-vault write (bash + Write tool) | **Allowed** (after the realpath + `updatedInput` fixes) |
| `WebFetch`/`WebSearch` | **Denied** — `canUseTool` |
| Bash `dangerouslyDisableSandbox` | **Denied** — `canUseTool` + `allowUnsandboxedCommands: false` |
| Bash network egress to a non-allowlisted domain (`curl example.com`) | **macOS: NOT blocked** |

**Platform caveat (network):** per-domain network allowlisting relies on the sandbox proxy, which is
**Linux/WSL only** (`socatPath` is documented Linux/WSL-only). On **Linux (production)** bash network
egress is confined to `allowedDomains`; on **macOS (dev)** seatbelt does not enforce it, so a
prompt-injected agent could exfiltrate via `curl` in dev. Filesystem confinement (the hard boundary —
"where damage happens") and tool-egress denial hold on **both** platforms. Since production is Linux
and macOS is dev-only, this is an accepted residual — but **D12 attachments (untrusted input) must
only be enabled where network egress is enforced (Linux)**, or with an added macOS network guard.

## Follow-ups (out of scope here)
- D12 attachments (builds on the per-run `allowRead` hook).
- Tightening the read scope.
- Optional: warm sandbox / perf tuning if per-run overhead matters.

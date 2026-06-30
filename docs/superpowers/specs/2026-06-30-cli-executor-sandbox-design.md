# CLI/repo executor — Docker sandbox (slice #3) — design

Date: 2026-06-30

Makes `cli`/repo tools actually **install** and **run**, sandboxed in Docker, with least-privilege **permissions by declaration**. Builds on #2a (the `tools/<id>/TOOL.md` model + `invoke` dispatch). Companion: `2026-06-29-tool-supply-data-model-design.md`, and the design decisions in memory `executor-and-agent-core-design`.

## Goal

A hand-authored `cli`-type `TOOL.md` can be **installed** (owner-gated, built into a Docker image) and **invoked** (a fresh sandboxed container per call, creds injected at runtime), so installing a repo and using it locally actually works — safely by default.

## Scope

**In:** the `cli`/repo executor only — Docker image build (install) + sandboxed `docker run` (invoke); the `permissions` declaration + the install-time permissions-review gate + enforcement (filesystem/creds/limits strict; network `none`-default + egress-proxy allowlist); install state; the dashboard "Install & trust" action + a headless CLI.

**Out (other slices):** MCP-proxy executor (#3b); profile-dir creds (`materialize: profile`) + OAuth (#4); persistent session-state volumes (a #3 follow-up); raw-socket-proof egress hardening (#3c/managed); the agent that authors/drives installs (#2b); the full vault-centric dashboard redesign (parked). `http` tools are unchanged (#2a, no sandbox). `mcp` `invoke` stays inert ("executor not available yet — #3b").

## Principles (locked)

- **Safety-by-default, always.** A code-executing tool must never reach the host filesystem, the secret store, or other tools — local or managed. (`http`/http-mcp run no local code → never sandboxed.)
- **Docker is the single isolation mechanism** for code tools — required ONLY when installing a `cli`/`mcp` tool; the base product + `http` need zero Docker. Fail with a clear "needs Docker" message if absent. Raw-host execution is not offered.
- **Least-privilege by declaration.** The `TOOL.md` declares what the tool may touch; the install-gate is a permissions review; the container enforces deny-by-default.
- **Mechanism ≠ intelligence.** #3 exposes *capabilities* (gated install, sandboxed run, enforcement) — not a scripted pipeline. The orchestration intelligence is #2b.

## Manifest additions

`cli` tools (the existing `source`/`install`/`bin`/`materialize` fields from #2a stay) gain:
```yaml
image:
  base: "node:20-slim"        # the base runtime image (declared in v1; inferred later)
permissions:
  network: none                # none | ["api.cloak.com", "*.cloak.com"] | any (any = loud warning)
  filesystem: []               # extra read paths beyond the tool's own workdir (rare); default deny
limits:
  timeoutMs: 60000             # optional; defaults applied if absent
  memoryMb: 512
materialize:
  inject: env                  # v1 supports `env` only; `profile` declared but "not supported yet" (→ #4)
  env: { GOG_TOKEN: "${conn.TOKEN}" }
```
(Creds are implied by `requires` + `materialize.env` — only the chosen connection's keys, injected at run, never baked into the image.)

## Permissions model

- **Default deny-all.** A tool run gets ONLY: its own image workdir, the injected connection creds, the declared network, and the declared resource limits. No host fs, no secret store, no other tools.
- **Install-gate = permissions review.** On install/approve, the owner is shown the requested permissions ("cloakbrowser requests: network to `*.cloak.com`, the `companyB` creds — approve?") and approves. Approval is recorded with the install. Changing `permissions` requires re-approval.
- **Enforcement (v1):**
  - filesystem / creds / read-only-rootfs / memory / cpu / timeout → **strictly enforced** via `docker run` flags.
  - network → `none` (`--network none`, default) is the **hard boundary** — strictly enforced, no egress at all. A declared host-allowlist is routed through a small **egress-proxy** (HTTP(S)_PROXY in the container), but is **best-effort only**: with `--network bridge` the container has full outbound IP connectivity, and the proxy constrains *only* clients that honor `HTTP(S)_PROXY` — a tool that ignores the proxy env (or uses raw sockets) reaches any host directly. So treat a host-allowlist as a **soft guardrail**, not a hard limit.
  - **Deferred to managed hardening (#3c):** real per-host enforcement (an `--internal` Docker network where the proxy is the *sole* route + IP-allowlist firewalling). Until then, the enforced-safe network choices are `none` (no egress) or `any` (explicit, full outbound). Residual risk on the soft path: a rogue tool could exfiltrate the single cred it was handed (the host fs + the rest of the store stay unreachable — those are hard-enforced).
  - **Container hardening (v1, enforced):** `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit`, read-only rootfs with a writable `--tmpfs /tmp`, plus `--memory`/`--cpus`. The run timeout kills the *container* (not just the docker client) via `--name` + `docker kill`/`rm`.

## Install model (owner-gated, Docker image build)

Trigger: owner-explicit — dashboard **"Install & trust"** or CLI `npm run tool -- install <id>`. Never caller-triggered.

1. Read `tools/<id>/TOOL.md` → `source`, `install`, `bin`, `image.base`, `permissions`, `requires`.
2. **Permissions review** → owner approves (the "trust this code" gate; recorded).
3. **Build the image** (the install code itself is arbitrary → it runs inside the Docker build, never on the host). Generated Dockerfile: `FROM image.base` → clone `source.repo` at the pinned `ref` (or install the `package`) → run the `install` commands → set workdir/`bin`. Tag `geode-tool/<id>:<ref>`, cached per (id, ref). **No secrets in the image.**
4. **Smoke-test**: run one container from the new image (a declared smoke action or a trivial `bin` check). On failure → install fails, tool stays "not installed", report the build/smoke error. (Never mark installed without one clean run.)
5. **Record state** → `~/.geode/tools/<id>/installed.json`: image tag, `ref`, approved-permissions snapshot, timestamp. Dashboard shows installed/not + approved perms.
6. **Re-install** on changed `ref`; **re-approval** on changed `permissions`. `uninstall` removes the image + state.

Requires Docker present and running; a clear actionable error otherwise.

## Run model (sandboxed `invoke`)

`invoke(tool, action, params, connection?)` on an installed `cli` tool:
1. **Check installed** (image + `installed.json`) → else actionable error "owner must install this tool first" (the caller never triggers install/build).
2. Resolve the connection + load its bundle (as #2a).
3. Resolve the action's `command` template with `${params.X}` (creds go via env, not the command line).
4. **Run a fresh container** from `geode-tool/<id>:<ref>`:
   - `docker run --rm` (ephemeral; removed after).
   - Creds as env via a **temporary `--env-file`** (mode 600, deleted after) — never `-e VAR=value` on the CLI (would leak in the host `ps`). Only the chosen connection's keys.
   - Network per `permissions.network` (`--network none` default, or via the egress-proxy allowlist).
   - **Read-only rootfs, no host mounts**; `--memory`/`--cpus`; a **timeout** that kills the container.
   - Command: `<bin> <resolved command>`.
5. Capture stdout/stderr + exit code → `InvokeResult { status: exitCode, body: <stdout as JSON-or-text> }` (0 = success). A non-zero exit is returned (the caller sees the failure); only **infra failure** (image missing, timeout, docker error) throws.

**v1 decisions (senior-dev call):** per-call fresh container (no pooling — pooling only if latency proves a real problem); stateless per call + `env`-only creds (persistent session-state volumes and `materialize: profile` are deferred; a tool that declares the deferred features gets a clear "not supported yet").

## Integration

- **`invoke` dispatch**: the #2a `invoke` already dispatches by `type`; #3 replaces the `cli` branch (currently the inert "#3" error) with the Docker runner. `http` unchanged; `mcp` stays inert (#3b).
- **Dashboard**: the Tools tab gains an "Install & trust" action on `cli` tools (permissions review → approve → install → status), plus installed/not + approved-perms display. (Minimal addition on the existing tab; the vault-centric redesign is separate/parked.)
- **CLI**: `npm run tool -- install <id> | uninstall <id>` headless path.
- **Docker abstraction**: a thin `docker.ts` wrapper (build/run/rm/inspect) injected like other deps, so tests can stub it.

## Testing

- **Unit (vitest, no Docker):** the Dockerfile/`docker run` argument generation (pure functions: given a manifest + connection bundle → the exact build steps + run flags incl. `--network none`, the env-file content, limits, the command). The permissions-review/approval state logic. The install-state read/write. The "not installed" / "needs Docker" / "not supported yet" error paths — all with a stubbed `docker.ts`.
- **Integration (Docker, excluded from the unit suite — like the eval):** a tiny fixture `cli` tool (a trivial repo with a Dockerfile that echoes its input) — verify: image builds, `invoke` runs sandboxed and returns the echoed output, `--network none` is enforced (a network-requiring action fails when not declared), the temp env-file is cleaned up, and the install gate blocks an unapproved tool.

## Success criteria

1. A hand-authored `cli` `TOOL.md` (e.g. a fixture echo-tool) installs via the owner action: a Docker image is built (install sandboxed), smoke-tested, and recorded; the dashboard shows it installed with its approved permissions.
2. `invoke` on that tool runs a fresh sandboxed container, injects only the chosen connection's creds (via env-file), enforces `network: none` + read-only-rootfs + limits, and returns the action's stdout/exit.
3. An uninstalled tool's `invoke` returns "owner must install first"; a missing-Docker environment returns a clear "needs Docker"; a tool declaring a deferred feature (`materialize: profile`, persistent state) returns "not supported yet".
4. All pure-logic pieces are unit-tested with a stubbed Docker; the Docker path is integration-tested behind a Docker-required gate. No regression in the existing suite.

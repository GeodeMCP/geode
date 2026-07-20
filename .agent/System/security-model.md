# Security model

The secret broker, the `invoke` executors, the two confinement systems, and OAuth. **This file distinguishes what is enforced from what is aspirational** — several published claims are currently stale. Derived from the code as of 2026-07-20.

**Related docs:** [Architecture & runtime](architecture.md) · [Known inconsistencies](known-inconsistencies.md) · [Verify the sandbox](../SOP/verify-sandbox.md)

## Naming: "sandbox" means two unrelated things

| File | Confines | Mechanism |
|---|---|---|
| `src/agentSandbox.ts` | the **vault agent** | seatbelt (macOS) / bubblewrap (Linux) + SDK `canUseTool` |
| `src/sandboxRun.ts` | **tool binaries** | Docker containers |

Different mechanism, different subject, different config surface. Keep them lexically distinct when writing or reviewing.

## Secret broker

**Storage:** a single AES-256-GCM-encrypted JSON blob at `<secretsDir>/secrets.enc` (`src/secrets.ts:45-56`). The whole map is encrypted as one unit on every write and decrypted on every read — no per-secret envelope, no partial read. Layout is `IV(12) || GCM tag(16) || ciphertext`; the AEAD tag is verified, so tampering throws rather than yielding garbage.

**Key:** `GEODE_SECRETS_KEY` (hex or base64, exactly 32 bytes) or an auto-generated 32-byte file at `<dir>/key`, mode 0600 with chmod re-applied to defeat a permissive umask.

> **The key file sits in the same directory as the ciphertext.** On-disk encryption therefore protects against backup/sync leakage, not against anyone who can read the directory.

Four sibling HMAC keys are minted through the same helper into subdirectories — `sign` (artifact URLs), `oauth`, `session`, `link`. Key separation is real and deliberate.

**Refs** are flat strings: `` `${tool}__${label}__${key}` ``. `loadConnBundle` resolves every `requires` key for the chosen connection and **throws if any is unset**, with a hint naming the exact CLI command.

### How "callers never see secrets" is actually guaranteed

The guarantee is **architectural, not cryptographic**, resting on three facts:

1. The MCP `invoke` schema has **no credential field** — the caller names a *connection label*; the value is resolved server-side.
2. The `SecretStore` handle is never passed to the agent. Every execution path narrows it to `Pick<SecretStore, "get">` — read-only, no list.
3. Read-side APIs expose names only: `GET /api/secrets` returns `{ref, requiredBy}`; graph derivation reduces a connection to `{label, configured: boolean}`.

### Where that guarantee is thin

- **Response bodies are returned verbatim.** `src/invoke.ts:51-55` returns the upstream body untouched and `src/server.ts:110` serializes the whole result into MCP text content. If an upstream API echoes a key, or a `cli` binary prints its own config, it flows straight back to the caller. **There is no redaction layer anywhere in the codebase.**
- **`resolveTemplate` will interpolate `${conn.X}` into any templated field**, including `http.url` and `http.query`. A manifest that puts a credential in a query string puts it in upstream access logs. Nothing in `parseManifest` forbids it.
- **The vault agent authors tool manifests.** The permission handler validates manifest *syntax* on write, never *destination*. A prompt-injected agent that writes a manifest pointing `http.url` at an attacker host, with the owner's key in a header, is a credential-exfiltration path the broker does not close. **This is the sharpest unmitigated edge in the design.**

## The three invoke executors

Common prologue for all kinds: `loadTool` (id validated against `/^[a-z0-9-]+$/`, so `..` traversal is blocked) → action lookup → `resolveConnection` → `loadConnBundle` → dispatch on `manifest.type`.

### `http` — unconfined

Runs in the kernel's own Node process via `fetch`. **No sandbox, no container, no egress restriction.** This is the unconfined path.

Secrets are injected by template substitution. Two strictness levels matter: `url` and `body` use `resolveTemplate` (throws on unresolved ref), while `headers` and `query` use `resolveTemplateOptional`, which **drops the whole entry** when a referenced value is absent. Consequence: an auth header referencing an optional param silently vanishes and the request goes out unauthenticated, returning 401 rather than a clear error.

### `cli` — Docker per invocation

A fresh, single-use container per call, from the image built at install time. Refuses to run if `installed.json` is absent.

**Secret injection is via `--env-file`, never argv.** The temp file is written mode 0600 under `mkdtemp` and the directory is `rm -rf`'d in a `finally`. Three real hardening details:

- **Newline injection guard** — any env value containing `\r` or `\n` aborts the run before the file is written, preventing a credential from forging extra env lines.
- **`bin` is never template-resolved** (`src/tools.ts:69-71`) so it cannot carry a credential onto the process list.
- **`command` must be a `string[]` argv array** — the space-separated form is a parse error, closing shell word-splitting on interpolated values.

Container hardening (`src/docker.ts:31-37`): `--rm`, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 256`, `--tmpfs /tmp:rw,noexec,nosuid,size=64m`, memory/CPU caps. **No volume mounts at all** — the container cannot see the vault or the host filesystem.

Note `stderr` is discarded on the success path, so a failing CLI returns an exit code with no diagnostic.

### `mcp` — in-process proxy

Acts as an MCP client over StreamableHTTP to an external server. **stdio transport is explicitly unimplemented and throws** (`src/mcpProxy.ts:48`), so Geode never spawns a local MCP server process today.

Secrets are injected **only into transport headers**, with `params` deliberately empty in that context — a header can carry a `${conn.*}` but never caller-supplied data.

Timeout bounds `initialize` and each `callTool`, but the preceding TCP/TLS handshake is only OS/undici-bounded (documented at `src/mcpProxy.ts:23-24`).

## Agent confinement

Two layers, and they are **not independently toggleable**.

### Layer 1 — SDK permission layer

`permissionMode: "default"` plus a programmatic `canUseTool` handler — **never `bypassPermissions`** while the sandbox is on. The rationale (`src/engine.ts:180-184`) is that the OS sandbox derives its file/network limits from the permission rules, so bypassing permissions would leave the sandbox inert.

`buildPermissionHandler` denies: `Bash` with `dangerouslyDisableSandbox`, `AskUserQuestion`, writes outside the vault, writes to generated files (`index.md`, `.geode/graph.json`), and invalid `TOOL.md` content (run through `parseManifest`, `Write` only — `Edit`/`MultiEdit` don't expose post-edit content).

`canonicalPath` realpaths the longest existing ancestor and re-appends the rest, so a not-yet-created file still resolves symlinks. This exists specifically for macOS `/tmp`→`/private/tmp`; without it, legitimate in-vault writes were falsely rejected.

> **Structural fragility, self-documented:** `WRITE_TOOLS` is a deny-by-**enumeration** list (`src/agentSandbox.ts:30-34`). A new file-mutating SDK tool inherits the allow-by-default posture. This is the single most fragile line in the enforcement model and must be re-checked on every SDK upgrade.

### Layer 2 — OS sandbox

Implemented by the Claude Agent SDK, not by this repo — Geode only configures it. **Fail-closed by default:** enabled unless `GEODE_SANDBOX_DISABLE` is set, with `failIfUnavailable: true` hardcoded, so a Linux host missing `bwrap`/`socat` refuses the run rather than running unconfined.

`allowUnsandboxedCommands: false` is the settings-level twin of the `dangerouslyDisableSandbox` deny — defense in depth on the same vector.

**Sandbox OFF also disables write confinement.** With `GEODE_SANDBOX_DISABLE=1`, `buildQueryOptions` returns `bypassPermissions` + `allowDangerouslySkipPermissions` **and no `canUseTool` at all**. Intentional and commented ("run genuinely unconfined, loudly opted in"), but it means you cannot keep vault-write confinement while dropping the OS layer.

### What is actually enforced, per platform

| Vector | macOS | Linux | Enforced by |
|---|---|---|---|
| Bash write outside vault | Blocked | Blocked | OS sandbox |
| Write/Edit tool outside vault | Blocked | Blocked | `canUseTool` — its *only* boundary; the OS layer doesn't cover host-process tools |
| Planted `.claude/settings.json` | Ignored | Ignored | `settingSources: []` |
| Bash `dangerouslyDisableSandbox` | Denied | Denied | `canUseTool` + `allowUnsandboxedCommands:false` |
| Bash egress to non-allowlisted domain | **NOT blocked** | Blocked | OS sandbox proxy (needs `socat`) |
| WebFetch / WebSearch egress | **NOT blocked** | **NOT blocked** | *deny lifted — see below* |

> ### Stale published claim
>
> `README.md:27` and `docs/superpowers/specs/2026-07-01-agent-sandbox-design.md:157` both state that the handler denies `WebFetch`/`WebSearch`. **It does not.** `src/agentSandbox.ts:141-143` is an explicit comment recording that the deny was lifted so the agent can read live API docs while authoring tools, to be restored behind a chat approval flow (issue #27). `src/constitution.ts:18` now permits them as read-only. **Tool-level network egress from the agent is currently open on every platform, and the README is wrong.**

**Treat macOS as a development environment, not a hardened one.** Per-domain egress needs `socat` and is Linux/WSL-only. `scripts/verify-sandbox.ts:74-79` encodes this asymmetry directly by SKIPping the network check on darwin.

The sandbox design doc adds a hard constraint: **D12 attachments (untrusted input) must only be enabled where network egress is enforced (Linux).** Attachment staging *is* wired on all platforms (`src/query.ts:124`) with no platform check. Whether that constraint is currently honoured on macOS dev is an open question — see [Known inconsistencies](known-inconsistencies.md).

## Confirmed bypasses in the tool-install trust model

These three were verified directly against the source, not inferred.

### 1. Approved permissions are never enforced at run time

`installer.ts:27` records the owner-approved `permissions` into `installed.json`. But `sandboxRun.ts:19` only checks that the file **exists**, and the actual network mode is read from the **live manifest** (`m.permissions?.network`, `sandboxRun.ts:28`).

Since `TOOL.md` is agent-writable, an agent can widen a tool from `network: none` to `network: any` after approval and it takes effect on the next invoke with no re-consent. **The TOFU record is written but never checked.**

### 2. The dashboard install route has no consent step

The CLI path (`src/toolCli.ts:31-47`) prints every requested permission and requires a literal `y`. The dashboard route passes `manifest.permissions ?? {}` straight through as `approvedPermissions` (`src/dashboard/api.ts:198`) — **the manifest approves itself.** No confirmation, no diff, no prompt. It is session-gated so it isn't remote-anonymous, but the meaningful consent gate exists only in the CLI.

### 3. The container egress allowlist is very likely broken

For `permissions.network: string[]`, the container gets `--network bridge` plus `HTTP_PROXY`/`HTTPS_PROXY` pointing at a host-side proxy. Two problems:

- **`HTTP_PROXY` is a convention, not a control.** The container has unrestricted bridge egress; the env vars are suggestions well-behaved HTTP clients honour. Any tool opening a raw socket bypasses the allowlist entirely. Unlike `network: none` — which *is* kernel-enforced — this is a soft boundary.
- **The proxy binds `127.0.0.1` on the host** (`src/egressProxy.ts:62`) and hands the container `http://127.0.0.1:<port>`, which inside the container's network namespace is *the container's own loopback*. `host.docker.internal` is not used. So allowlisted tools most likely fail to connect rather than being filtered. No test covers the container↔proxy hop.

**Net effect: `network: none` and `network: any` behave as documented; `network: [allowlist]` does not.**

### Also unenforced

`permissions.filesystem` and `runtime: "host" | "container"` are declared in the manifest type and **read nowhere**.

## Installer

Only handles `type: cli`. Builds a Docker image from the manifest: a `--depth 1` git clone of `source.repo` (in a throwaway `alpine/git` stage, keeping git out of the runtime image) or `npm install -g` / `pip install` of `source.package`, plus the manifest's `install[]` RUN lines. Then a **smoke run** with no args, `--network none`, `--env-file /dev/null`, 30s timeout — must exit 0.

No credentials ever reach the build; they appear only at run time via `--env-file`.

**But:** `source.*` and `install[]` are concatenated into Dockerfile text with **no escaping**, and the build runs unconfined on the host Docker daemon. Since manifests are agent-authored and installs are owner-approved, this is TOFU-gated arbitrary build-command execution — not remote, but real. Combined with bypass #2 above, the dashboard install path reaches it without a consent prompt.

There is no registry, no repo allowlist, and no signature/checksum verification. Editing `TOOL.md` after install does not invalidate `installed.json`, and if `source.ref` is unchanged the image tag is unchanged too — so a manifest edit changes behaviour without any rebuild or re-approval. An unpinned tool caches under `:latest` forever.

## OAuth

**Geode is the OAuth *server*** — both Authorization Server and Protected Resource — implementing the MCP remote-server auth spec so a client like claude.ai can add the vault as a custom connector. Geode is never an OAuth *client*; third-party credentials go through the secret broker as static values.

Flow: Authorization Code + **mandatory PKCE S256** + Dynamic Client Registration, with refresh tokens. `/authorize` requires an exact-match `redirect_uri` and `resource` exactly equal to `<base>/mcp` (resource-indicator binding).

**Token storage is stateless — nothing is persisted.** Every artifact is an HMAC-signed blob `"<kind>.<base64url(json)>.<sig>"`. TTLs: access 1h, refresh 30d, code 60s, auth-request 10min. Access and refresh tokens carry `aud` and are rejected on mismatch.

Consequences of statelessness, stated plainly:

- **`registerClient` returns the entire registration as the `client_id`** — there is no client database. A client_id is unbounded in length and never expires.
- **Auth-code single-use is an in-memory `Set`**, never pruned and **not surviving a restart**. Within the 60s window, a restart makes a code replayable.
- **There is no revocation** — no endpoint, no token store to revoke against. Rotating the `oauth` key is the break-glass, invalidating all tokens.

Parked: managed-tunnel SaaS path, revocation + connected-clients UI, Client ID Metadata Documents, multi-scope least privilege (a single `vault` scope covers all four tools), multi-user.

### Secret links

`mintSecretLink` produces a signed blob carrying `{ref, exp, nonce}` — **never the value**. The `/auth/s/:token` routes sit deliberately *outside* the session guard so a link can be handed to a non-owner to type a credential. Consumption happens *after* a successful write, so a transient failure leaves the link reusable.

**Single-use is enforced by an in-process `Set` and does not survive a restart** — after a restart only the 10-minute `exp` bounds the token.

### Accounts

Single owner in `account.json`, mode 0600. scrypt with a 16-byte random salt and 32-byte derived key, **default cost parameters (N=16384), no explicit tuning**. Min length 10, `timingSafeEqual` verification.

`npm run owner reset` simply `rmSync`s `account.json` — a full local takeover primitive for anyone with filesystem access.

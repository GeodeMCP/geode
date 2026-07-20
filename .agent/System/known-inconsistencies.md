# Known inconsistencies & open edges

Findings from a full code scan on 2026-07-20. **This is a snapshot, not a backlog** — nothing here has been fixed by writing it down. Items marked **confirmed** were verified directly against the source during the scan; items marked **unverified** were surfaced by reading and still need a test or a manual check.

Ordered roughly by consequence.

**Related docs:** [Security model](security-model.md) · [Vault data model](vault-data-model.md) · [Dashboard & frontend](dashboard-and-frontend.md)

## Security & trust

### 1. Approved tool permissions are never enforced at run time — **confirmed**

`installer.ts:27` records owner-approved `permissions` into `installed.json`; `sandboxRun.ts:19` only checks the file **exists**, and reads the live network mode from the **current manifest** (`sandboxRun.ts:28`). Since `TOOL.md` is agent-writable, a tool can be widened from `network: none` to `network: any` after approval, effective on the next invoke with no re-consent.

### 2. The dashboard install route has no consent step — **confirmed**

`src/dashboard/api.ts:198` passes `manifest.permissions ?? {}` as `approvedPermissions` — the manifest approves itself. The CLI path (`src/toolCli.ts:43`) requires a literal `y` after printing every requested permission. Session-gated, so not remote-anonymous, but the consent gate exists only in the CLI.

### 3. The container egress allowlist is very likely broken — **confirmed by reading, needs a live test**

The proxy binds `127.0.0.1` on the **host** (`egressProxy.ts:62`) and hands the container `HTTP_PROXY=http://127.0.0.1:<port>`, which inside the container's namespace is the *container's own* loopback. `host.docker.internal` is not used. Allowlisted tools most likely fail to connect rather than being filtered. Separately, `HTTP_PROXY` is a convention rather than a control — the container has unrestricted bridge egress, so any tool opening a raw socket bypasses it regardless.

`network: none` and `network: any` behave as documented. `network: [allowlist]` does not.

### 4. README and the sandbox design doc claim a WebFetch/WebSearch deny that no longer exists — **confirmed**

`README.md:27` and `docs/superpowers/specs/2026-07-01-agent-sandbox-design.md:157` say the handler denies `WebFetch`/`WebSearch`. `src/agentSandbox.ts:141-143` records that the deny was deliberately lifted (issue #27). Agent tool-level egress is open on every platform. The published docs overstate the security posture.

### 5. D12 attachments may not be gated to Linux as the spec requires — **unverified**

The sandbox design doc states untrusted-input attachments must only be enabled where network egress is enforced (Linux). `src/query.ts:124` threads `attachmentDirs` into `allowRead` with no platform check found. Needs an explicit decision: gate it, or accept and document the dev-only risk.

### 6. `WRITE_TOOLS` is deny-by-enumeration — **confirmed, self-documented**

`src/agentSandbox.ts:30-34`. A new file-mutating SDK tool inherits allow-by-default. Re-check on every Agent SDK upgrade.

### 7. Agent-authored manifests can point a credential at an arbitrary host — **confirmed, unmitigated**

The permission handler validates manifest *syntax* on write, never *destination*. `resolveTemplate` will interpolate `${conn.X}` into `http.url` or `http.query`. There is no redaction layer on responses anywhere in the codebase. This is the sharpest open edge in the design.

### 8. Stateless-OAuth consequences — **confirmed, by design but undocumented**

Auth-code single-use is an in-memory `Set` that does not survive a restart (a code is replayable within its 60s TTL across a restart). Secret-link single-use has the same property. There is no revocation; key rotation is the only break-glass. `client_id` never expires.

### 9. Secret-store key sits beside the ciphertext — **confirmed, by design**

`<dir>/key` and `<dir>/secrets.enc` are siblings. Encryption protects against backup/sync leakage, not against directory read access. Worth stating explicitly in any deployment guidance.

## Correctness

### 10. Oversized uploads are silently truncated — **confirmed**

`src/dashboard/api.ts:90-106` configures busboy with `fileSize: 25MB` but registers no `limit` handler on the file stream. Busboy truncates and emits `limit`, which nobody observes, so the truncated buffer is written and the response is `200 { added: [...] }`. A file over 25 MB is silently corrupted rather than rejected. Zip entries bypass the check entirely — the limit applies to the archive, not its expanded contents. Not covered by `test/dashboard/uploads.test.ts`.

### 11. Three divergent `walkMd` implementations — **confirmed**

`graph.ts:32-33`, `lint.ts:22`, `capabilities.ts:51`, with three different skip sets. Only `graph.ts` excludes `.geode` and the three kernel files; only `graph.ts` and `capabilities.ts` exclude `tools/`. A file can therefore be linted but not graphed, or vice versa.

### 12. The dashboard file-write path has no generated-file guard — **confirmed**

The agent is denied writes to `index.md` and `.geode/graph.json` (`agentSandbox.ts:154-156`), but `workspace.safeResolve` doesn't block them, so `POST /api/file` can overwrite both. Inconsistent enforcement of the same invariant across the two write paths.

### 13. Secret changes don't invalidate `graph.json` — **confirmed**

Setting or deleting a secret is not a rebuild trigger, so `connections[].configured` and the rendered `state="ok|needs-setup"` can be stale until the next rebuild.

### 14. `resolveWikilink` cannot match root-level ids — **confirmed**

`graph.ts:95` does a suffix match on `/name`, so a node whose id contains no `/` is unreachable by wikilink. Low impact while markdown links are canonical, but it makes the legacy path quietly lossy.

### 15. `MDLINK_RE` matches image embeds — **confirmed**

`graph.ts:91` and `lint.ts:60`: the `!` in `![alt](src)` falls outside the match, so an image path can become a graph edge or a broken-link finding.

### 16. Malformed `TOOL.md` files vanish silently — **confirmed**

Skipped without diagnostics in both the graph (`graph.ts:68-70`) and the legacy summary (`capabilities.ts:67`). No lint check covers this, so a typo'd manifest simply disappears from the capability list.

## Gaps & dead weight

### 17. The vault lint has no automatic path and no npm script — **confirmed**

`lintVault` has exactly one caller, `lintCli.ts`. No server route, no dashboard endpoint, no query-time hook, and **no `package.json` script** — `npm run lint` is ESLint. It must be run as `tsx src/lintCli.ts`. A dashboard health panel is explicitly deferred.

### 18. `deriveCapabilities` has one remaining consumer — **confirmed**

Only `GET /api/gaps` (`api.ts:224`), and only its `.gaps` field. The `tools`, `recipes` and `text` it computes on every call are dead work. The graph carries the same information via `type === "gap"` nodes.

**Do not delete `capabilities.ts` when migrating** — its `parseFrontmatter` is the parser the graph compiler itself imports.

### 19. Stale hand-maintenance prompts in the web UI — **confirmed**

`web/src/components/Chat.tsx:179` and `web/src/views/VaultHome.tsx:66` still instruct the agent to maintain `index.md` and `log.md` by hand. This contradicts the constitution (`constitution.ts:8-9`) and the hard write-deny in `agentSandbox.ts:154-156`. `log.md` was removed from the model entirely in the meta-layer work.

### 20. The unused `workspace` MCP param — **confirmed**

Declared in three input schemas and two arg types, read nowhere. Either a reserved multi-vault placeholder or dead schema; the code doesn't say. Resolve when #6 lands.

### 21. Declared-but-unenforced manifest fields — **confirmed**

`permissions.filesystem` and `runtime: "host" | "container"` are parsed and never read. `GraphNode.count` is hardcoded to `1` and rendered. Frontmatter `status` is parsed and consumed nowhere.

## Smaller papercuts

- **`POST /api/logout` is reachable unauthenticated** (`api.ts:85`) — idempotent cookie clear, harmless, but inconsistent.
- **`GET /api/connect` returns the raw MCP bearer token** to any session-authenticated browser — a session-scoped XSS would exfiltrate full MCP access. Arguably necessary for the Connect page's purpose.
- **The rate-limiter Map never evicts** (`rateLimit.ts:8`) — unbounded growth per distinct key on a public deployment.
- **`SESSION_TTL` and the cookie `Max-Age`** are duplicated constants that must be kept in sync by hand.
- **No SSE heartbeat** — an intermediary with a short idle timeout could drop a long run's stream. The `X-Accel-Buffering` header implies nginx is anticipated, but no reverse-proxy config exists in this repo.
- **No dev proxy for `/auth` or `/artifacts`** in `web/vite.config.ts` — secret-link and artifact flows need port 8787 directly under `vite dev`. Unverified.
- **Login collapses all failures to "Wrong credentials"** — a 429 reads as a wrong password.
- **`runManager.cancel()` takes no run id** — one caller's cancel aborts whatever is active, regardless of who started it. Queued runs cannot be cancelled at all.
- **Run IDs are not unique across restarts** (`run-${++counter}`).
- **`~/.geode/uploads` is one global folder** for all conversations despite the `AttachmentStore` doc-comment saying "per-conversation". There is no conversation id anywhere.
- **`cli` invoke discards stderr** on the success path — a failing CLI returns an exit code with no diagnostic.
- **`web/tsconfig.tsbuildinfo` is committed** while `web/dist` is gitignored — likely accidental.

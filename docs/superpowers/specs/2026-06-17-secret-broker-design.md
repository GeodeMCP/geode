# v1-core completion: query rename · broker + invoke · OKF capabilities · artifacts — Design Spec (#3)

> Status: **Draft, updated 2026-06-18.** This cut **completes the v1 core**. Builds on the kernel +
> context-tools and implements the locked model (architecture §2): the vault **prepares + explains**;
> the **caller executes** via `invoke`; the **agent never calls integrations and never touches
> secrets**. See `2026-06-17-context-vault-architecture.md`.

## 1. Goal & scope

Five deliverables, together completing the v1 core:

- **(A) Rename `delegate` → `query` + remove `find`.** The agentic tool becomes `query` (it
  researches/plans, never executes). The mechanical `find` tool is removed — all context access goes
  through `query`.
- **(B) OKF-derived `list_capabilities`.** Replace the hand-maintained `capabilities.md` with discovery
  **derived** from OKF frontmatter + integration manifests (revises the built #2).
- **(C) Secret broker + caller-only `invoke` + ONE sample HTTP integration + secret CLI.**
- **(D) Artifacts** — a store + URL serving so `query`/`invoke` outputs are downloadable.
- **(E) Constitution** — `query` never executes; it returns `invoke` plans; OKF frontmatter; never
  calls integrations.

**Out of scope (deferred):** signed auth-link + auth screen + OAuth (→ #4); CLI-spawn/mcp-server/script
integration types, per-action typed tools, the repo/OAuth installer (→ #5); hard OS/container isolation
+ workspace-scoped namespaces (→ hosted); autonomous lint; agent-executes-via-integrations (Path 2 —
out by design).

## 2. (A) Rename `delegate` → `query` + remove `find`

Mechanical, behavior-preserving for `query`:
- `src/delegate.ts` → `src/query.ts`; `delegate` → `query`, `DelegateDeps` → `QueryDeps`,
  `DelegateResult` → `QueryResult`; `makeDelegateHandler` → `makeQueryHandler`; the MCP tool `delegate`
  → `query` (new description, below). Update `remember` (it wraps `query`), `index.ts`, all tests/docs.
- **Remove `find`:** delete the `find` MCP tool registration, `src/find.ts`, and `test/find.test.ts`.
  The agent does its own searching with its built-in Read/Grep/Glob tools — our `find` was only a
  caller-facing convenience and is no longer in the surface.

`query` MCP description (caller-facing): *"Ask your Geode vault — it searches your context, recipes and
SOPs and returns a synthesized answer, OR an executable plan (the exact `invoke` calls to run). Prefer
this for anything that needs your vault's knowledge. It prepares; you execute via `invoke`."*

## 3. (B) OKF + derived `list_capabilities`

- **Adopt OKF frontmatter** for vault concepts: `type` (required) + `title`/`description`/`tags`.
  Seeded `AGENTS.md`/`index.md` carry OKF-style frontmatter; recipes/skills are OKF concepts.
- **`seedVault` change:** seed `AGENTS.md` + `index.md` (OKF) only; **drop the hand-maintained
  `capabilities.md` scaffold.** (`log.md` is created on first run as before.)
- **`listCapabilities(root)` change → `deriveCapabilities(root)`:** compute the menu on demand:
  - **Integrations** — read every `integrations/*/manifest.json` → `{name, description, actions[]}`.
  - **Recipes/skills** — scan markdown files for OKF frontmatter with `type` in (`recipe`,`skill`,`sop`)
    → `{title, description, path}`.
  - Return a structured object **and** a human-readable rendering. Never reads a stored capabilities file.
- **Pure helpers (testable):** `parseFrontmatter(md): {type?, title?, description?, tags?}` and the
  manifest reader. `list_capabilities` MCP tool returns the rendered menu.

## 4. (C) Secret broker + `invoke` + sample integration + CLI

### 4.1 Broker (`src/secrets.ts`)
```ts
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;   // never logged
  list(): Promise<string[]>;                   // ref names only
  delete(ref: string): Promise<void>;
}
export function createSecretStore(opts: { dir: string; key: Buffer }): SecretStore;
```
Encrypted blob (`<dir>/secrets.enc`, AES-256-GCM, random IV per write). Location `GEODE_SECRETS_DIR`
(default `~/.geode/secrets/`), **outside the vault**. Key from `GEODE_SECRETS_KEY` or a generated
`0600` `<dir>/key`. Workspace-namespacing is a seam (single namespace in v1).

### 4.2 Integration manifest (`src/integrations.ts`)
```ts
export interface IntegrationAction { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; url: string; headers?: Record<string,string>; query?: Record<string,string>; body?: unknown; description?: string }
export interface IntegrationManifest { name: string; type: "connection"; description: string; requires: string[]; actions: Record<string, IntegrationAction> }
export function loadIntegration(root: string, name: string): Promise<IntegrationManifest>;
export function resolveTemplate(input: string, ctx: { params: Record<string,unknown>; secrets: Record<string,string> }): string;
```
Templates use `${params.X}` (caller) and `${secrets.X}` (broker). **Only `invoke` resolves
`${secrets.X}`** — secrets are never written into manifests or returned to the caller. First cut: HTTP
`connection` type only.

### 4.3 `invoke` (`src/invoke.ts`) — server-handled
```ts
export interface InvokeArgs { integration: string; action: string; params?: Record<string,unknown>; workspace?: string }
export interface InvokeResult { status: number; body: unknown; artifact?: { path: string; url: string } }
export function invoke(deps: { root: string; secrets: SecretStore; artifacts: ArtifactStore; fetchFn?: typeof fetch }, args: InvokeArgs): Promise<InvokeResult>;
```
Flow: load manifest → find action (clear error if missing) → gather `requires` secrets (clear error
naming the missing ref + the CLI command) → resolve templates → `fetchFn(url, {method, headers, body})`
→ `{status, body}`. If the response is a file (per the action/`Content-Type`), persist via the artifact
store and include `{artifact}` (§6). Secret injected only into the request; `fetchFn` injectable for tests.

### 4.4 Secret CLI (`src/secretCli.ts`)
`npm run secret -- set <REF>` (hidden prompt → encrypted), `list`, `rm <REF>`. Human → broker; never
through the agent/chat. Stand-in for the dashboard auth screen until #4.

## 5. (E) Constitution (`src/constitution.ts`)
Add: *"You never execute external actions and never call integrations. When asked how to do something
that uses an integration, read its `integrations/<name>/manifest.json` and return the exact ordered
`invoke(integration, action, params)` calls the caller should make. Author concepts as OKF files (YAML
frontmatter with at least `type`; plus `title`/`description`/`tags`). Keep `index.md` + `log.md`
current."* (Also drop the old "update capabilities.md" line — discovery is now derived.)

## 6. (D) Artifacts (`src/artifacts.ts` + server route)
```ts
export interface ArtifactStore { dir: string; save(relPath: string, data: Buffer): Promise<{ path: string; url: string }>; resolve(relPath: string): string /* abs, path-safe */ }
export function createArtifactStore(opts: { dir: string; baseUrl: string; signer: Signer }): ArtifactStore;
```
- **Store:** `artifacts/` in the workspace, added to the vault's `.gitignore` by `seedVault` (agent
  writes there; never committed). `query`/`invoke` outputs land here.
- **Serve:** kernel route `GET /artifacts/<path>` — **bearer-auth by default** (download with the token).
  **Opt-in public** via a **signed URL** (`?sig=…&exp=…`, HMAC over path+exp, unguessable, optionally
  expiring) that needs no bearer — for external sharing. `mintPublicUrl(path, ttl?)` produces it.
- **Path-safe:** serve only within `artifacts/` (reuse the safeResolve pattern). Reject traversal.
- **Return:** file-producing results include `{ artifact: { path, url } }`.

## 7. File structure (geode repo)
| File | Change |
|---|---|
| `src/query.ts` (rename from `delegate.ts`) | `query`, `QueryDeps`, `QueryResult`, `makeQueryHandler` refs |
| `src/find.ts`, `test/find.test.ts` | **delete** |
| `src/secrets.ts`, `src/integrations.ts`, `src/invoke.ts`, `src/secretCli.ts`, `src/artifacts.ts` | create |
| `src/capabilities.ts` | `listCapabilities` → `deriveCapabilities` (manifests + OKF frontmatter); add `parseFrontmatter` |
| `src/seed.ts` | seed OKF `AGENTS.md`/`index.md` only; drop `capabilities.md`; add `artifacts/` to vault `.gitignore` |
| `src/constitution.ts` | §5 edits |
| `src/config.ts` | add `secretsDir`, `artifactsDir`, `baseUrl` (for artifact URLs) |
| `src/server.ts` | rename find/delegate; register `query` + `invoke`; add `GET /artifacts/*` route (bearer + signed); `make*Handler`s |
| `src/index.ts` | build secret store + artifact store; wire into query/invoke deps; rename refs |
| `package.json` | add `secret` script |
| tests | `query.test.ts` (renamed), `secrets/integrations/invoke/artifacts/capabilities.test.ts`, server tests; remove find test |
| `test/e2e.manual.md` | update to `query`; add `invoke` + artifact + `query`-returns-a-plan checks |

## 8. Data flow
- **`query`:** caller asks → agent searches/synthesizes/plans over the vault (incl. reading manifests
  for plans) → returns answer or `invoke`-plan (+ artifact URL if it produced a file). Never executes
  externally, never reads secrets.
- **`invoke` (caller):** caller → server → broker.get(secret) → resolve templates → HTTP call →
  `{status, body, artifact?}`. Secret stays server-side.
- **`list_capabilities`:** derive from manifests + OKF frontmatter → menu.
- **Add secret:** CLI → encrypted store (outside vault).
- **Artifact download:** `GET /artifacts/<path>` with bearer, or a signed public URL.

## 9. Error handling
- Missing integration/action → clear not-found tool error. Missing secret → structured error naming
  the ref + CLI command. HTTP non-2xx → return `{status, body}`; fetch failure → structured tool error.
- Decrypt failure (bad key/corrupt store) → surfaced clearly, not silently "no secret".
- Artifact: unknown path → 404; bad/expired signature → 403; traversal → rejected.

## 10. Testing
- **Unit:** `SecretStore` round-trip + wrong-key-fails (temp dir); `parseFrontmatter` + `deriveCapabilities`
  (temp vault with manifests + OKF files → expected menu); `resolveTemplate`; `loadIntegration`; `invoke`
  with mocked `fetchFn` (request built incl. injected secret; missing-secret error; secret never in the
  result); `ArtifactStore` save + path-safety + signed-URL verify (valid/expired/tampered); the server
  handlers (`query`, `invoke`, artifact route auth). Rename: existing `query`(ex-delegate)/`remember`
  tests stay green.
- **Manual e2e** (`test/e2e.manual.md`): set a secret via CLI; add a sample `integrations/httpbin/manifest.json`
  (GET injecting a header from the secret); `invoke` it → confirm success + secret not echoed in our
  result; `query("how do I call the httpbin integration?")` → returns the exact `invoke(...)` plan
  without reading the secret; produce an artifact and download it via its bearer URL + a minted public URL.

## 11. Out of scope / deferred
(See §1.) Notably: the agent calling integrations (Path 2) is **out by design**; OAuth + the signed
auth-link UI land with #4; the hard OS/container boundary + tenant-scoped namespaces with the hosted layer.

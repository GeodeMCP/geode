# Secret Broker + invoke — Design Spec (Sub-project #3, first cut)

> Status: **Draft (brainstorm output, 2026-06-17).** Builds on the kernel + context-tools.
> Implements the locked model (architecture §2, §5.8): the vault **prepares + explains**, the
> **caller executes** via `invoke`; the **agent never calls integrations and never sees secrets**.

## 1. Goal & scope

Give the caller the ability to run an authenticated integration action through the vault, with the
**secret injected server-side** so neither the caller nor the agent ever sees it. Three deliverables
(the merged core of #3 + #5):

1. **Secret broker** — an encrypted-at-rest secret store + server-side injection (in-server).
2. **`invoke`** — a caller-only MCP tool that runs one integration action; the server injects the
   secret and returns only the result.
3. **One sample integration** + the integration-manifest format, so `invoke` has something to call.
   Plus a **CLI** to add secrets (no dashboard yet).

Also: a small **constitution** tweak so `delegate` returns ready-to-run `invoke` plans (the agent
reads manifests; it never calls integrations).

**Out of scope (deferred):** the signed auth-link + unified auth screen and OAuth (→ dashboard #4);
CLI-spawn / `mcp-server` / `script` integration types (only HTTP-API integrations here); the broader
repo/OAuth installer and multi-integration management (→ #5); the hard OS-user/container boundary
(→ hosted layer); workspace-scoped secret namespaces (a seam now, single namespace in the first cut).

## 2. The broker (`src/secrets.ts`)

A `SecretStore` over an **encrypted file outside the vault** (never in git):

```ts
export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  list(): Promise<string[]>;     // ref names only — never values
  delete(ref: string): Promise<void>;
}
export function createSecretStore(opts: { dir: string; key: Buffer }): SecretStore;
```

- **Storage:** one encrypted blob (`<dir>/secrets.enc`) holding a `Record<ref,value>`, **AES-256-GCM**
  (random IV per write, auth tag verified on read). Read-decrypt-modify-encrypt-write on each op
  (fine at single-user scale).
- **Location:** `GEODE_SECRETS_DIR` (default `~/.geode/secrets/`), **outside** the workspace/git.
- **Key:** 32 bytes from `GEODE_SECRETS_KEY` (hex/base64) if set; otherwise generated once to
  `<dir>/key` with `0600` perms. Loaded at startup; never written to the vault.
- **Workspace-namespacing:** a seam (ref could become `<workspace>/<ref>`); single namespace for now.

Posture (architecture §5.8): the secret is decrypted only in memory at injection time; it is never
handed to the agent and is used only on the caller's `invoke`. In-server is sufficient for the
self-host first cut; the hard boundary is the hosted layer's job.

## 3. CLI to add secrets (`src/secretCli.ts`)

`npm run secret -- set <REF>` prompts for the value **hidden** (no echo) and stores it encrypted;
`npm run secret -- list` prints ref names; `npm run secret -- rm <REF>` deletes. The value goes
human → broker; it never passes through the agent or the chat. (This is the stand-in for the
dashboard auth screen until #4.)

## 4. Integration manifest (`src/integrations.ts`)

Integrations live per workspace at `integrations/<name>/manifest.json`. First cut = HTTP-API only.

```ts
export interface IntegrationAction {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;                          // may contain ${params.X}
  headers?: Record<string, string>;     // values may contain ${params.X} / ${secrets.X}
  query?: Record<string, string>;       // ditto
  body?: unknown;                       // optional; string values may contain placeholders
  description?: string;
}
export interface IntegrationManifest {
  name: string;
  type: "connection";                   // first cut: HTTP-API "connection" only
  description: string;
  requires: string[];                   // secret refs, e.g. ["WEATHER_API_KEY"]
  actions: Record<string, IntegrationAction>;
}
export function loadIntegration(root: string, name: string): Promise<IntegrationManifest>;
export function resolveTemplate(input: string, ctx: { params: Record<string, unknown>; secrets: Record<string, string> }): string;
```

- `resolveTemplate` replaces `${params.X}` (from the caller) and `${secrets.X}` (from the broker)
  placeholders. **Only `invoke` resolves `${secrets.X}`** — secrets are never written into manifests
  or returned to the caller.
- The manifest's `requires` + `actions` feed both `invoke` (machine-readable) and the agent's
  planning (it reads the manifest to build `invoke` calls). It also feeds `capabilities.md`.

## 5. `invoke` (`src/invoke.ts`) — server-handled

```ts
export interface InvokeArgs { integration: string; action: string; params?: Record<string, unknown>; workspace?: string; }
export interface InvokeResult { status: number; body: unknown; }
export function invoke(
  deps: { root: string; secrets: SecretStore; fetchFn?: typeof fetch },
  args: InvokeArgs,
): Promise<InvokeResult>;
```

Flow:
1. `loadIntegration(root, integration)`; find `actions[action]` (clear error if either is missing).
2. For each ref in `requires`, `secrets.get(ref)` → build the `secrets` map. **If any is missing →
   a clear error** ("secret `WEATHER_API_KEY` not set — add it with `npm run secret -- set WEATHER_API_KEY`").
   (This is the precursor to the signed-link flow.)
3. Resolve `url`/`headers`/`query`/`body` templates with `{ params, secrets }`.
4. `fetchFn(url, { method, headers, body })`; return `{ status, body }` (JSON if parseable, else text).
5. The secret is injected only into the outbound request; the returned result is the API's response.

`fetchFn` is injectable (defaults to global `fetch`) so tests mock HTTP deterministically.

## 6. Server wiring (`src/server.ts`)

Register a generic `invoke` tool (the deferred per-action-tools option stays deferred):

- **Description (caller-facing):** "Run one action of an integration in your Geode vault (the
  *caller* executes; the server injects the secret). First call `list_capabilities` / read the
  integration manifest to see actions + params. For *how* to do a multi-step task, ask `delegate`
  for a plan."
- **inputSchema:** `{ integration: z.string(), action: z.string(), params: z.record(z.any()).optional(), workspace: z.string().optional() }`.
- **Handler:** `makeInvokeHandler({ invoke: (args) => invoke(deps, args) })` → returns the result as
  text + `structuredContent: { status }`. Errors (missing integration/action/secret, HTTP failure)
  return a structured tool error (`isError: true`) — never throw to the transport.

`invoke` is **not** gated by the single-flight run queue (it's a cheap server call, like `find`).

## 7. `delegate` produces invoke-plans (`src/constitution.ts` tweak)

Add to the constitution: *"You never call integrations yourself. When asked how to do something that
uses an integration, read its `integrations/<name>/manifest.json`, and return the exact ordered
`invoke(integration, action, params)` calls the caller should make (with concrete param values where
known)."* No new tool — `delegate` already reads files; this just shapes its output.

## 8. File structure (geode repo)

| File | Responsibility |
|---|---|
| `src/secrets.ts` (create) | `SecretStore` (AES-256-GCM encrypted blob) + `createSecretStore` + key load/generate |
| `src/integrations.ts` (create) | manifest types + `loadIntegration` + `resolveTemplate` |
| `src/invoke.ts` (create) | the `invoke` operation (server-handled HTTP call + secret injection) |
| `src/secretCli.ts` (create) | the `secret` CLI (set/list/rm, hidden input) |
| `src/config.ts` (modify) | add `secretsDir` (+ key resolution) |
| `src/server.ts` (modify) | `makeInvokeHandler` + register the `invoke` tool |
| `src/index.ts` (modify) | build the secret store; pass it into the invoke deps |
| `src/constitution.ts` (modify) | add the "produce invoke-plans, never call integrations" rule |
| `package.json` (modify) | add the `secret` script |
| `test/secrets.test.ts`, `test/integrations.test.ts`, `test/invoke.test.ts` (create) | unit tests |
| `test/server.test.ts` (modify) | invoke-handler tests |
| `test/e2e.manual.md` (modify) | a real `invoke` + a `delegate`-returns-a-plan check |

## 9. Data flow

- **`invoke` (caller):** caller → `invoke` handler → `invoke(deps,args)` → load manifest, get secret
  from broker, resolve templates, HTTP call → `{status, body}` back. Secret stays server-side.
- **`delegate` plan (caller → vault):** caller asks "how do I do X"; the agent reads recipes +
  `integrations/*/manifest.json` + `capabilities.md`, returns the ordered `invoke` calls; the caller
  then runs them. The agent touches no secret.
- **Add a secret:** human runs the CLI → encrypted into the broker store (outside the vault).

## 10. Error handling

- Missing integration / action → clear not-found tool error.
- Missing required secret → structured error naming the ref + the CLI command to set it.
- HTTP error (non-2xx) → return `{ status, body }` (the caller decides); transport-level fetch
  failure → structured tool error.
- Decrypt failure (bad key / corrupt store) → surfaced clearly at the broker call, not silently
  treated as "no secret".

## 11. Testing

- **Unit:** `SecretStore` round-trip (set → get → list → delete; persists encrypted; wrong key
  fails to decrypt) in a temp dir; `resolveTemplate` (params + secrets substitution, missing
  placeholder behavior); `loadIntegration` (parse + missing-file error); `invoke` with a **mocked
  `fetchFn`** (builds the right request incl. injected secret header; missing-secret error;
  unknown-action error) — assert the secret never appears in the returned result; `makeInvokeHandler`
  (success → text+structured; error → `isError`).
- **Manual e2e** (`test/e2e.manual.md`): set a secret via the CLI; create a sample
  `integrations/httpbin/manifest.json` (GET that injects a header from the secret); `invoke` it and
  confirm the call succeeded; then `delegate("how do I call the httpbin integration?")` and confirm
  it returns the exact `invoke(...)` call without ever reading the secret.

## 12. Out of scope / deferred

- Signed auth-link + unified auth screen + OAuth (→ #4 dashboard).
- CLI-spawn / mcp-server / script integration types; per-action typed MCP tools; the repo/OAuth
  installer (→ #5).
- Hard OS-user/container isolation (→ hosted layer); workspace-scoped secret namespaces.
- Letting the agent call integrations (Path 2) — **explicitly not built, by design** (§2).

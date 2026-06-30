# Tool-supply data model & layout (slice #2a) — design

Date: 2026-06-29

Foundation for the unified tool-supply model. Companion: `2026-06-26-tool-supply-and-caller-surface-decisions.md` (the model), `2026-06-17-context-vault-architecture.md` §2.1 (reversed). This slice defines the **data model + storage** only — it does NOT run CLIs/MCPs (slice #3) or do OAuth (#4) or build the install flow (agent-core slice #2b + #3).

## Goal

A complete, stable manifest format for all three executor types (`http` / `cli` / `mcp`), a per-connection credential-bundle store, the `tools/<id>/` layout, and the `list_capabilities`/`invoke` resolution against it — such that **`http` tools work end-to-end on the new model**, and `cli`/`mcp` tools are **listable but not yet runnable** (their executors land in #3).

## Scope

**In:** the `TOOL.md` manifest schema (full, all 3 types); the connection model + `requires`; the credential-bundle store (generalised from named secrets); `runtime` as a declared+validated field; `list_capabilities`/`invoke` resolution; migration of the existing `integrations/` sample + readers to `tools/`.

**Out (later slices):** actually executing `cli`/`mcp` (subprocess runner, MCP-proxy client, container enforcement) = #3; outbound OAuth setup/refresh = #4; the agent-core layer (constitution + seeded SOPs + install-SOP) = #2b; the dashboard install UX.

## Layout

```
vault/
  tools/
    <id>/
      TOOL.md            # manifest = YAML frontmatter + a "how to use" markdown body
```
- `<id>` = the directory name, lowercase-hyphen, unique.
- Manifests are **markdown + YAML frontmatter** (the `SKILL.md`/OKF convention), not JSON — one vault format for concepts, SOPs, and tools; agent- and human-editable; the body is free documentation for `list_capabilities` L2 + the caller.

## Manifest schema (frontmatter)

### Common envelope (every `TOOL.md`)
```yaml
id: gmail                 # = directory name
name: Gmail
type: cli                 # http | cli | mcp
description: Send and read email from the user's Gmail accounts.
runtime: host             # host | container — cli/mcp only; http ignores it (see Runtime)
requires: [TOKEN]         # secret keys each connection's bundle must contain
connections:              # labels + NON-secret metadata only
  - { label: acme-sales, description: "Company B (Acme) sales inbox" }
  - { label: personal,   description: "Personal inbox" }
actions:
  send:
    description: Send an email.
    params: [{ name: to, required: true }, { name: subject, required: true }, { name: body, required: true }]
    # + executor-specific fields (below)
```
Templating in any executor/auth field: `${params.X}` (caller input), `${conn.X}` (from the selected connection's bundle). Secret **values** never appear in the file.

### `http`
```yaml
type: http
requires: [API_KEY]
connections: [{ label: default }]
actions:
  create_issue:
    params: [{ name: title, required: true }]
    http:
      method: POST                                   # GET|POST|PUT|PATCH|DELETE
      url: https://api.linear.app/graphql
      headers: { Authorization: "Bearer ${conn.API_KEY}" }
      query: {}                                       # optional
      body: '{"query":"mutation{...}","variables":{"title":"${params.title}"}}'   # optional
```

### `cli` / repo
```yaml
type: cli
runtime: host
requires: [TOKEN]
source: { repo: "https://github.com/CloakHQ/CloakBrowser", ref: "v1.2.0" }   # OR package: "npm:foo" / "pip:bar"
install: ["npm ci", "npm run build"]                 # ordered setup commands (run by #3)
bin: "./dist/cloak"                                   # entrypoint
materialize:                                          # how a connection's creds reach the subprocess
  inject: env                                         # env | profile
  env: { GOG_TOKEN: "${conn.TOKEN}" }                 # when inject: env
  # profile: { restore: "${conn.PROFILE}", into: "$HOME/.config/gog" }   # when inject: profile (blob → dir)
actions:
  fetch:
    params: [{ name: url, required: true }]
    command: "fetch --url ${params.url}"              # appended to bin
```

### `mcp`
```yaml
type: mcp
runtime: host
requires: [TOKEN]
transport: { kind: stdio, command: "npx -y @modelcontextprotocol/server-github", ref: "0.6.0" }   # OR { kind: http, url: "https://mcp.example.com" }
materialize: { inject: env, env: { GITHUB_TOKEN: "${conn.TOKEN}" } }
actions:
  open_pr:
    remote_tool: create_pull_request                 # the external MCP tool this geode action proxies
    params: [{ name: title, required: true }, { name: head, required: true }, { name: base, required: true }]
```
- MCP actions are an **explicit curated mapping** (one door, narrow-waist), not auto-import. (`expose: all` auto-import is an optional #3 convenience, not the default.)

## Connections, credential bundles & store

- **Manifest** holds connection labels + descriptions (non-secret) and tool-level `requires` (the secret keys each connection must provide).
- **Store** holds the secret values + status per connection. Generalised from the current flat named-secrets store to a keyed bundle:
  ```
  key: <tool-id>/<connection-label>
  value: { values: { TOKEN: "…" },     # kv — used by http now
           blobs?: { PROFILE: <ref> } } # opaque (e.g. a captured CLI profile dir) — schema now, used by cli in #3
  ```
  Same AES key/mechanism; only the keyspace becomes structured. `secretCli` gains per-connection set (`secret set gmail/acme-sales TOKEN …`).
- **`${conn.X}`** resolves from the selected connection's bundle `values` at invoke time.
- **Status** (for `list_capabilities`): 2a computes `configured` (bundle has all `requires` keys) vs `needs_setup`. Live health (OAuth token expired → `needs_reconnect`) is #4.

## Runtime / isolation

- `runtime: host | container`, declared on `cli`/`mcp` tools (http has no runtime). In 2a it is **declared + validated against the enum only**; enforcement (actually sandboxing) is #3.
- **Default `host`** for v1 (single-owner local — no Docker dependency to get started). `container` is opt-in and becomes the required default in the managed/multi-tenant mode. The field exists now so #3 + the managed motion change nothing.

## Resolution

**`list_capabilities`** — derived from the filesystem: scan `tools/*/TOOL.md` frontmatter (+ OKF concept files for the context index), merge with store status. Tiered: L1 = map (id/name/type/description + connections-with-status); L2 = `list_capabilities(tool)` → actions + params. (Same shape the eval prototyped; `deriveCapabilities` retargeted from `integrations/` to `tools/`.)

**`invoke(tool, action, params, connection?)`** — order:
1. Load `tools/<tool>/TOOL.md` → not found ⇒ actionable error.
2. Find `action` → missing ⇒ error.
3. Resolve connection: given ⇒ must be a valid label (else error listing available); omitted + exactly one connection ⇒ use it; omitted + multiple ⇒ `specify a connection: …`.
4. Load the connection's bundle; missing a `requires` key ⇒ `needs_setup` error.
5. Dispatch by `type`:
   - **`http`** — existing broker logic, retargeted to `${conn.X}`/`${params.X}` over the TOOL.md action. Works end-to-end.
   - **`cli` / `mcp`** — return `executor '<type>' not available yet (slice #3)` (defined but inert).
- The MCP `invoke` tool param **`integration` → `tool`**, plus an optional `connection`.

## Migration (`integrations/` → `tools/`, no back-compat — pre-release)

- Convert the sample integration (httpbin) + seed scaffold → `tools/httpbin/TOOL.md` (`http`). Old `requires: [DEMO_KEY]` → a `default` connection; `${secrets.DEMO_KEY}` → `${conn.DEMO_KEY}`; value stored under `httpbin/default`.
- Retarget readers and delete the old path: `capabilities.ts` (scan `tools/`), `invoke.ts` (TOOL.md + bundle + dispatch by type), `secrets.ts` (per-connection keyspace), `seed.ts` (seed a `tools/` example), `secretCli.ts` (per-connection set), `server.ts` (invoke param rename).
- **Add a YAML parser dependency** — the frontmatter is deeply nested (actions/params/http blocks), beyond any minimal hand-rolled OKF parser.

## Testing (TDD)

- Manifest parsing for each type (envelope + http/cli/mcp executor fields) from `TOOL.md` frontmatter.
- Connection resolution: valid / invalid (error lists labels) / single-default / multi-requires-explicit / `needs_setup`.
- Credential-bundle store: set/get per `<tool>/<label>`; `requires` check.
- `invoke` dispatch: `http` action runs (against a stub HTTP server) with `${conn.X}`/`${params.X}` resolved; `cli`/`mcp` return the inert "not available yet" error.
- Migration: the converted httpbin `TOOL.md` parses and http-invokes; old `integrations/` path is gone.

## Success criteria

1. A vault with `tools/<id>/TOOL.md` (all three types present) lists correctly via `list_capabilities` (tiered, with connection status).
2. An `http` tool invokes end-to-end on the new model with per-connection credential injection.
3. A `cli`/`mcp` tool is listable but `invoke` returns a clear "executor not available yet (#3)" error.
4. The credential store holds per-connection bundles; `${conn.X}` resolves from the selected connection.
5. The old `integrations/` path is fully removed; the migrated sample works; all tests green.

# Dashboard & web frontend

The human-facing half of the kernel: session auth, the vault workshop UI, and how it differs from the MCP surface. Derived from the code as of 2026-07-20.

**Related docs:** [MCP & HTTP surface](mcp-and-http-surface.md) · [Architecture & runtime](architecture.md) · [Known inconsistencies](known-inconsistencies.md)

## Composition

`src/index.ts:74-114` is the single composition root. `mountDashboard` (`src/dashboard/index.ts:20`) mounts, in order: the `/api` router, the `/auth` router, then static SPA + fallback.

`webDir` resolves to `<repo>/web/dist`. If it's missing, every non-API GET returns `503 "Dashboard SPA not built. Run: cd web && npm run build"`. **There is no root-level script that builds `web/`** — the SPA must be rebuilt by hand after frontend changes.

## Three auth schemes, one server

| | Dashboard | MCP | Secret links |
|---|---|---|---|
| Credential | `geode_session` HMAC cookie from email+password | Static `GEODE_AUTH_TOKEN` or OAuth token | One-time HMAC URL token |
| Identity | per-account (`res.locals.principal`) | none — the token *is* the identity | none |
| Used by | humans | machine callers | third parties with no account |
| Commit behaviour | review mode, no auto-commit | auto-commit | n/a |

### Owner account

A single machine-local owner in `account.json` (`~/.geode` by default), mode `0600`. Password hashing is `scryptSync(password, salt16, 32)` with a fresh salt on every write; verification uses `timingSafeEqual` (`src/account.ts:22,35,53`). Minimum 10 characters.

Two creation paths: env bootstrap via `GEODE_OWNER_EMAIL`/`GEODE_OWNER_PASSWORD` at startup, or `POST /api/setup` (409 if an owner already exists). The store interface is deliberately shaped for a future multi-account backend (`src/account.ts:24-25`) — relevant to the managed-vaults direction (issue #38).

### Sessions

Token is `"<expMs>.<sub>.<sig>"` with `sig = HMAC-SHA256(sessionKey, "<exp>.<sub>")`, base64url (`src/session.ts:6-13`). Cookie `geode_session`, `HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`, plus `Secure` when `baseUrl` is https.

**The same session cookie is shared with the OAuth consent flow** (`src/oauth/router.ts:6,53,64-68`): a dashboard login satisfies `/authorize`, and logging in on the consent screen sets the dashboard cookie. This is intentional and worth remembering when touching either.

### Rate limiting

`createRateLimiter` (`src/dashboard/rateLimit.ts:6-18`) is a fixed-window in-memory Map. Two instances: dashboard login/setup at 8/60s, OAuth at 10/60s. **No other route is rate-limited**, including `/api/query` — run load is bounded instead by `runManager` (`queueLimit` 4), which rejects with `"kernel busy: run queue is full"`.

## Routes

Unauthenticated (declared above the session gate at `api.ts:88`): `GET /api/auth-info`, `POST /api/setup`, `POST /api/login`, `POST /api/logout`.

Session-gated: everything else. See [MCP & HTTP surface](mcp-and-http-surface.md#dashboard-api-srcdashboardapits58-238) for the full table.

`GET /api/connect` returns `{ mcpUrl, authToken, tools, publicBaseUrl }`. `publicBaseUrl` is `null` on loopback, which is what gates the Connect page's URL/OAuth card behind the "managed tunnel (premium)" CTA.

## SSE

There is **no persistent event bus and no `EventSource`**. SSE is a per-request response encoding on two POST endpoints, because `EventSource` cannot POST.

`openSse` (`src/dashboard/sse.ts:7-16`) sets the streaming headers including `X-Accel-Buffering: no`. The `stream()` helper (`api.ts:111-128`) forwards each `ProgressEvent` as `event: progress`, then emits exactly one terminal `event: result` or `event: error`, then closes.

Client side: `fetch` + `res.body.getReader()`, decoded by `parseSseChunk` (`web/src/api.ts:27-40`), which splits on `\n\n` and retains the trailing partial block.

Two consumers drive UI from the same stream: `Chat.submit` routes events into the timeline reducer, and `VaultHome.send` piggybacks — on a `tool` event named `Write`/`Edit`/`MultiEdit` it selects `e.data.summary` (the file path) and refreshes the tree live, so the file tree updates *during* a run.

**No heartbeat is emitted**, so an intermediary with a short idle timeout could drop a long run's stream.

## Attachment staging

Files land in `~/.geode/uploads` — hard-wired at `src/index.ts:59`, **not env-configurable** unlike the secrets/artifacts/transcripts dirs. It sits outside the vault, so uploads are never committed.

`stageFiles` (`src/dashboard/uploads.ts:9-33`) resolves every target against the root and throws on escape, auto-expands `*.zip` via AdmZip, and returns the written relative paths.

### How the agent learns about them

On `POST /api/query` the server lists the folder and, if non-empty, passes `attachmentDirs` and `attachmentFiles` into `runQuery`. Two downstream effects:

1. **Prompt injection.** `buildAttachmentNote` (`src/query.ts:72-80`) prepends a block naming the folder and listing up to 100 files. It explicitly warns that dotfile-skipping `find` filters will miss everything, because the staging folder lives under a hidden `.geode` directory — this was a real, hard-to-diagnose failure. It also inlines the two-turn onboarding protocol.
2. **Sandbox grant.** The dirs are added to `filesystem.allowRead` — read-only. Write stays confined to the vault.

### Attachments flip the agent's role

`role = opts.role ?? (attachmentDirs?.length ? "librarian" : "desk")` (`src/query.ts:106`). Staged files switch the constitution fragment **and disable scoped graph retrieval** (desk-only). This is easy to miss when debugging why retrieval context is absent.

### Known bug: silent truncation on oversized uploads

Busboy is configured with `limits: { fileSize: 25MB, files: 1000 }` (`api.ts:91`), but the handler only listens for `data` and `end` — there is **no `limit` event handler** on the file stream. Busboy truncates the stream and emits `limit`, which nobody observes, so the truncated buffer is written and the response is `200 { added: [...] }`. A file over 25 MB is silently corrupted rather than rejected. Zip entries bypass the size check entirely, since the limit applies to the archive, not its expanded contents. **Confirmed by reading `api.ts:90-106`; not covered by `test/dashboard/uploads.test.ts`.**

## The commit model

Both paths run through `query()`, keyed off `opts.commit === false`.

**Dashboard = review mode** (`src/index.ts:97` passes `{ commit: false }`):

- The pre-run "checkpoint dirty tree" branch is skipped, so runs **accumulate** onto the working tree — prior agent drafts and manual Viewer edits alike. This is deliberate (`src/query.ts:92-94`); there is no forced commit gate between turns.
- After the run: `commit: null`, `filesTouched` from `uncommittedChanges()`. No git write at all.
- On error, partial edits are **left on the tree** for inspection.
- The human commits via `POST /api/commit` or discards via `POST /api/discard`.

**MCP = auto-commit:** a dirty tree is first checkpointed as `dashboard-draft: checkpoint before <runId>` so a pending human draft is never wiped, then the run commits, then a **second, separate** commit `graph: rebuild <runId>`.

The difference in artifact handling matters: `POST /api/commit` regenerates artifacts **first** and folds them into a **single** commit with the user's changes, versus MCP's two commits. A rebuild failure is logged and swallowed on both paths — the commit still proceeds.

### Path safety

All file routes go through `workspace.safeResolve` (`src/workspace.ts:30-57`): rejects `..`, blocks top-level `.git`/`artifacts`/`node_modules`, and walks `realpath` up the chain so an in-vault symlink can't escape. `tools/` is deliberately **not** blocked so the editor can edit `TOOL.md`.

## Transcripts

JSONL, one record per line, at `<transcriptsDir>/transcript.jsonl` (default `~/.geode/transcripts`). Machine-local, **not** in vault git.

```ts
{ runId, ts, instruction, events: ProgressEvent[], result?: {text, metrics?}, error?, attachments?: string[] }
```

The **full progress event array is persisted per turn**, including tool detail and tool output — so the file grows quickly and can contain whatever the agent read. Worth knowing as a data-retention consideration.

Writes are synchronous `appendFileSync`, safe only because `runManager` serializes runs. Reads silently skip corrupt or half-written lines.

Two consumers: `buildHistoryPreamble` (last 6 records, each side truncated to 400 chars) prepended to the agent's instruction; and `buildFromHistory` in the browser, which replays stored events through the **same** `applyProgress` reducer used live, then strips `animate` so a reload renders statically.

## Frontend

React 18 + TypeScript + Vite. `build` = `tsc -b && vite build`. Dev proxy forwards `/api` to `:8787` — but **not** `/auth` or `/artifacts`, so secret-link and artifact flows need port 8787 directly under `vite dev`.

**There is no router.** `App.tsx` holds `view` state over `"Vault" | "Connect" | "Secrets"` and conditionally renders. URLs are not reflected, so deep links, back-button and refresh always land on Vault. The server-side SPA fallback exists but nothing consumes the path.

### Views

- **`VaultHome`** — the three-column workspace: `Chat | FileTree | Viewer`. Appends a **synthetic** `artifacts` dir node to the tree. **Deletes route through the agent**, not `DELETE /api/file`: it fires an autoRun `/delete <path>` so the agent also reconciles `index.md` and references.
- **`Connect`** — per-client config generator. Claude Desktop uses an `npx mcp-remote` stdio bridge with the token passed via `env.AUTH_HEADER` to dodge a space-in-arg bug. Token masked by default.
- **`Secrets`** — board of `tool__connection__KEY` refs, sealed vs unset, values never returned. Because a secret link is opened in a *different* tab, the board refreshes on `window.focus` while a link is pending.
- **`Setup` / `Login`** — first-run and returning. Login collapses all failures to "Wrong credentials", so a 429 reads as a wrong password.

### Components

`Chat` (timeline rendering, drag-drop target, Esc/Stop → `POST /api/cancel`, inline dirty banner with Commit/Discard), `FileTree` (expanded set persisted in `localStorage`, dirty roll-up dots, two-step delete confirm suppressed for `tools`/`backlog`), `Viewer` (mode matrix: editing → CodeEditor, artifact → ArtifactPanel, `TOOL.md` → ToolPanel, dirty → colored diff, markdown → sanitized render), `CodeEditor` (CodeMirror 6; external value changes pushed via `dispatch` so typing isn't clobbered), `ToolPanel` (shows declared `permissions` as a trust prompt before install), `NeedsAttention` (bell drawer aggregating pending files + unconfigured connections + backlog gaps).

### Timeline reducer

`web/src/timeline.ts:18-78` — `thinking` → new item; `tool` → appended to the trailing `activity` group; `tool_result` → back-scans for the matching `toolId` and closes it; `todos` → replaces the most recent todos item since the last user item; `text` → agent bubble. `applyResult` clears still-running steps and appends the final answer **only if it differs** from the last agent bubble, deduping against a trailing streamed `text`.

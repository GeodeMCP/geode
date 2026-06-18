# Dashboard — Design Spec (Sub-project #4)

> Status: **Draft, 2026-06-18.** The web UI for the self-host kernel: an authenticated
> **operator console** for your vault. Builds on the kernel + context-tools + broker/invoke/
> artifacts (all merged to `main`). Realizes the validated §5.11 dashboard from the architecture
> doc (`2026-06-17-context-vault-architecture.md`) and the §5.9 auth flow. Visual source of truth:
> `docs/design/geodemcp-visual-style.md` (tokens), `docs/design/app.css` (real CSS from the
> predecessor app), and `docs/design/mockups/` (validated mockups).

## 1. Goal & scope

A web dashboard, served by the kernel, that lets the owner **see and operate** their vault: talk to
the vault agent, browse/diff/commit knowledge, and manage the operational surface (capabilities,
integrations, secrets, artifacts). It is the human-facing front of everything the kernel already does
headlessly.

**In scope:** the authenticated console — a chat-first **Vault home** (3-pane: chat · file-tree ·
viewer + commit/discard) plus top-bar views **Capabilities · Integrations · Secrets · Artifacts**,
an **integration detail** view (with per-action test = `invoke`), the **§5.9 secret-entry auth
screen** (API-key variant), dashboard **login**, and **SSE** realtime.

**Out of scope (deferred):**
- Public marketing/landing page → SaaS/go-to-market track.
- **OAuth** connect flows + repo/CLI **installer** → #5 (the auth screen's OAuth variant is mocked
  but not wired in #4; #4 ships the API-key entry path only).
- Full **multi-workspace** (switching, tenant isolation) → #6. #4 shows the single workspace name;
  the switcher is a visible-but-inert seam.
- `mcp`/`repo` integration **types** are represented in the UI model but only `connection` (HTTP API,
  built in Increment 2) is functional in #4; `mcp`/`repo` install lands with #5.

## 2. Architecture (kernel-served SPA + thin API + SSE)

One process, one port. The kernel's Express app gains a **dashboard module** that:
- serves the built **SPA** (React + Vite + TypeScript; styling ported from `docs/design/app.css`),
- exposes a thin first-party **`/api`** layer (JSON), and
- streams realtime via **SSE**.

`/mcp` (external AI clients, bearer) and `GET /artifacts/*` (bearer + signed) are unchanged. The
dashboard is a **first-party caller**: its `/api` handlers invoke the existing kernel functions
directly (`query`, `remember`, `invoke`, the secret broker, the artifact store, the git workspace,
`deriveCapabilities`, the event log) — **not** over MCP. Rationale: the dashboard is trusted and
co-located; an MCP hop would add latency and lose the direct progress/commit hooks.

Stack decisions (locked): **SSE** for server→client realtime (client→server via normal POST; no
WebSocket). Dashboard **login** = `GEODE_DASHBOARD_PASSWORD` → a signed, httpOnly **session cookie**.
The MCP **bearer token** stays exclusively for MCP clients; the **§5.9 signed link** stays exclusively
for secret entry. Three distinct auth mechanisms, three distinct purposes.

If `GEODE_DASHBOARD_PASSWORD` is unset, the dashboard routes return 503 (disabled) while `/mcp` keeps
working — self-host opt-in.

## 3. Storage model → UI representation (the organizing principle)

The backend storage of each thing dictates how it is represented. Three zones:

| Zone | Stored | In git? | Things | UI home |
|---|---|---|---|---|
| **Vault, git-tracked** (portable) | vault dir | yes | OKF knowledge pages; **integration manifests** (`integrations/<name>/manifest.json`); `log.md` | knowledge → tree/viewer; manifests → Integrations view |
| **Vault dir, gitignored** (local) | `artifacts/` | no | generated outputs | Artifacts view |
| **Outside vault, machine-local** (never git) | `~/.geode/...` | no | secrets/credentials (broker, AES); installed repo/CLI code + MCP runtime (`~/.geode/integrations/<name>/`, #5) | Secrets view; Integrations install-state |

**Locked data-model decisions:**
1. **Integration = umbrella concept.** A manifest's `type` ∈ {`connection` (HTTP API, v1), `mcp`,
   `repo`/`cli`}. "Connections" was the old name for the `connection` type only — retired as a
   separate folder.
2. **Manifests live in the vault** (git-tracked → portable; your ways-of-working travel with you).
3. **Credentials live in the broker** (machine-local, encrypted, never git).
4. **Installed code/MCP runtime lives outside the vault** (`~/.geode/integrations/`, machine-local; #5).
5. An integration's UI status is therefore **composed**: *manifest present · credential set? ·
   installed?* This is why integrations get a dedicated view rather than appearing as raw files.
6. **The knowledge tree shows only git-tracked OKF knowledge** — never integrations/secrets/artifacts
   (those are the top-bar views). One place per thing.

## 4. Views

### 4.1 Vault home (3-pane) — the heart
Validated layout (`docs/design/mockups/dashboard-home-with-nav.html`):
- **Top bar:** geode mark + Onest wordmark, workspace name (inert switcher seam), nav **Vault ·
  Capabilities · Integrations · Secrets · Artifacts** (active tab = emerald underline), live
  event-feed chip (pulsing dot), account.
- **Left — chat with the vault agent:** message bubbles + **change-cards** linking to a file/diff;
  composer ("Praat met je vault…"). Drives `query`/`remember`.
- **Middle — file-tree:** the knowledge tree (OKF pages). Status: **amber dot = modified**, **emerald
  "nieuw" badge = new file**.
- **Right — viewer:** faux-terminal panel; selected file with **live diff** (emerald add / red del),
  an amber "niet-gecommit" indicator, and **Commit / Verwerp** buttons.
- **Realtime (A/B/C):** (A) live diff streams into the viewer while the agent writes; (B) tree badges
  update; (C) change-cards appear in chat. All over SSE.

### 4.2 Capabilities (read-only)
Renders the **derived** menu (`deriveCapabilities`): recipes/skills (OKF frontmatter) + integrations
with their actions. No stored file.

### 4.3 Integrations (list) + integration detail
- **List:** one row per `integrations/*/manifest.json` — name, `type`, and **composed status**
  (credential set? installed?).
- **Detail** (`docs/design/mockups/connection-detail.html`, reached from the Integrations view — its
  left rail is the integrations list, **not** the vault tree): header (icon, name, status pill,
  type, scope, installed-since); **actions/tools** the integration offers, each with a **Test**
  button (runs `invoke(integration, action, params)` and shows the result — this is the only
  invoke-testing surface, contextual to an opened integration); **required secrets** (via the broker,
  masked, **write-only** — see 4.4); related OAuth credentials show status + expiry + "reconnect"
  (representation only; OAuth wiring is #5).

### 4.4 Secrets (write-only)
- **List:** ref names from `broker.list()` + which integrations `require` each (cross-referenced from
  manifests). **Never values.**
- **Operations:** **set / rotate / delete only — no reveal** (decision A). The agent never sees
  secrets; the logged-in owner cannot read them back either (smallest leak surface; rotate on doubt).
- **Add/rotate** is done through the **§5.9 auth screen** (4.6), not a plain field in the list.

### 4.5 Artifacts
List the gitignored `artifacts/` contents; **download** via the existing bearer route; **mint a
signed public URL** (existing `mintPublicUrl`) for external sharing.

### 4.6 Auth screen — §5.9 secret entry (`docs/design/mockups/auth-screen.html`)
A standalone page reached via a **signed, scoped, single-use, short-lived link** (`/auth/s/<token>`).
Shows what is being added (integration, provider, workspace) + validity (countdown, single-use,
scope). **API-key variant (in scope):** enter the value → it goes **straight into the broker,
encrypted**; the page states the agent never sees it, only the ref. **OAuth variant (deferred to
#5):** no input field; redirect to the provider; token lands in the broker. The link **never carries
the secret — it requests one.** The same signed-link primitive (HMAC over scope+exp, single-use)
reuses the artifact-signing pattern.

## 5. API surface (first-party, behind session auth)

Sketch (final shapes settled in the plan):
- **Auth/session:** `POST /api/login {password}` → set signed httpOnly cookie; `POST /api/logout`.
  Middleware guards all `/api/*` and SSE (401 otherwise). SPA assets served unauthenticated (they
  render the login screen when no session).
- **Chat/agent:** `POST /api/query {instruction}` and `POST /api/remember {content,source,title}` →
  start a run, return `{runId}`; `GET /api/runs/:runId/events` → **SSE** stream of progress, the final
  result, touched files, and artifacts (wraps the existing `onProgress`/run-manager/commit flow).
- **Knowledge:** `GET /api/tree` (knowledge files only — excludes integrations/artifacts),
  `GET /api/file?path`, `GET /api/diff?path` (vs HEAD), `GET /api/status` (changed/new for badges),
  `POST /api/commit`, `POST /api/discard`.
- **Capabilities:** `GET /api/capabilities` → `deriveCapabilities`.
- **Integrations:** `GET /api/integrations`, `GET /api/integrations/:name`,
  `POST /api/integrations/:name/test {action, params}` → `invoke(...)`.
- **Secrets:** `GET /api/secrets` (refs + requiring integrations); `POST /api/secrets/:ref/link` →
  mint a §5.9 signed entry link; `DELETE /api/secrets/:ref`. Value entry only via `GET/POST
  /auth/s/:token` (the auth screen).
- **Artifacts:** `GET /api/artifacts` (list); `POST /api/artifacts/public-link {path}` → signed
  public URL. Download via the existing `/artifacts/*` route.

## 6. Data flow

- **Chat:** caller → `POST /api/query` → run via the existing run manager/engine in **review mode**
  (auto-commit disabled) → `onProgress` events pushed over SSE (A: viewer live-diff, B: tree badges,
  C: chat change-cards) → on success the agent's changes are left **uncommitted** for the human; the
  stream returns the result, touched files, and artifact URLs. On failure the run resets-to-head and
  emits an error card (existing behavior). **The MCP path keeps auto-commit** (no human present); the
  dashboard adds a `commit: false` / review-mode run option to the existing run flow.
- **Commit/discard:** the viewer's **Commit** calls `workspace.commitAll`; **Verwerp** calls
  `workspace.resetToHead` (artifacts survive — gitignored). A new agent run requires a clean tree —
  the UI prompts to Commit or Verwerp pending changes first, consistent with the single-flight
  manager's existing clean-or-reset behavior.
- **Integration test:** detail view → `POST /api/integrations/:name/test` → `invoke` (broker injects
  the secret server-side) → result shown; secret never returned beyond the API's own echo.
- **Secret add:** Secrets view → mint signed link → auth screen → value → `broker.set` → consumed.
- **Capabilities/Artifacts:** direct reads of derived menu / artifact dir.

## 7. Visual system
Port `docs/design/app.css` (the real tokenized stylesheet) as the base. Non-negotiables from
`docs/design/geodemcp-visual-style.md`: OKLCH dark tokens (hue 165), white-alpha hairline borders,
three-step neutral text (never pure white); **emerald = identity/state/active/links** (low-alpha pills
+ stronger borders), **blue = the single primary action per view**; the four fonts (Geist body /
Instrument Sans chrome / Geist Mono code / Onest wordmark); radius scale + 999px pills; inline-SVG
icons, **never emoji**; restraint (one hero effect, `.15s` transitions, generous whitespace). Status
colors: **amber = modified, emerald = new** (knowledge tree); error red per spec.

## 8. Error handling
- No session → `401` on `/api` + SSE; SPA shows login.
- Dashboard disabled (no password configured) → `503` on dashboard routes; `/mcp` unaffected.
- Agent run failure → structured error **change-card** in chat + git reset-to-head (existing kernel
  behavior); the SSE stream emits an error event and closes.
- `invoke` failure → structured error in the test panel (existing handler).
- Secret/artifact routes keep their existing auth/`401`/`403`/`404`/traversal behavior.
- Single-flight run manager: a second concurrent run is queued or rejected with a clear "busy" message
  surfaced in the chat (existing behavior).

## 9. Testing
- **Server (unit/integration, like the kernel):** session login + cookie signing/verification; the
  `/api` handlers (tree/file/diff/commit/discard, integrations list/detail/test, secrets list/link/
  delete, capabilities, artifacts list/public-link); SSE event framing from a fake run; the §5.9
  signed-link mint/verify/single-use/expiry; auth middleware (401 paths).
- **Client:** key components (chat + change-cards, tree with status badges, viewer diff + commit,
  integration detail + test, secrets write-only list, auth screen) with a component test runner.
- **Manual e2e** (`test/dashboard.e2e.manual.md`): log in → ask a `query` and watch SSE progress +
  live diff → commit → open an integration and Test an action → add a secret via a signed link →
  download an artifact (bearer + minted public URL) → confirm no secret value is ever shown in the UI.

## 10. File structure (geode repo)
| Path | Responsibility |
|---|---|
| `src/dashboard/server.ts` | mount on the Express app: static SPA + `/api` + SSE + `/auth/s/*`; session middleware |
| `src/dashboard/api/*.ts` | route groups: `auth`, `runs` (query/remember + SSE), `knowledge` (tree/file/diff/commit), `integrations`, `secrets`, `artifacts`, `capabilities` |
| `src/dashboard/session.ts` | password login → signed cookie; verify middleware |
| `src/dashboard/secretLinks.ts` | §5.9 signed single-use link mint/verify/consume |
| `src/config.ts` | add `dashboardPassword`, `sessionSecret` (+ enable flag derived from password) |
| `web/` | the Vite SPA (React + TS), styles ported from `docs/design/app.css`; views per §4 |
| `src/index.ts` | wire the dashboard module into the kernel startup |
| `test/dashboard/*.test.ts`, `test/dashboard.e2e.manual.md` | per §9 |

(Reuses existing `query`/`ingest`/`invoke`/`secrets`/`artifacts`/`workspace`/`capabilities`/`eventLog`
modules unchanged.)

## 11. Increments (each ships working software)
- **Increment A — Foundation + Vault home:** dashboard module mounted on the kernel; SPA build +
  serving; password login + session; the **review-mode** run option (auto-commit disabled) on the
  existing run flow; `/api` for knowledge (tree/file/diff/status/commit/discard) and chat
  (`query`/`remember` + SSE progress); the 3-pane Vault home with realtime A/B/C and human Commit/
  Verwerp. Independently useful: talk to your vault and curate knowledge from the browser.
- **Increment B — Ops views:** Capabilities; Integrations (list + detail + per-action Test);
  Secrets (write-only list + §5.9 signed-link API-key entry via the auth screen); Artifacts (list +
  download + public link).

## 12. Deferred / seams
Public landing page (SaaS). OAuth connect + repo/CLI/MCP installer (#5; the auth screen's OAuth
variant and integration install-state are represented but not wired). Full multi-workspace switching +
tenant isolation (#6; workspace name shown, switcher inert). Hardened secret isolation (hosted layer).

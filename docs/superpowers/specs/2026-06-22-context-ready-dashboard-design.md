# Context-ready dashboard (Increment C) — Design Spec

> Status: **Draft, 2026-06-22.** Makes the dashboard genuinely usable for **pure context files** —
> reading, rendering, and hand-editing your knowledge — before any tools/integrations work resumes
> (#5 OAuth is parked). Builds on the merged dashboard (#4, Increments A+B). Spec for the dashboard:
> `2026-06-18-dashboard-design.md`.

## 1. Goal & scope

Today the dashboard can run the agent and **review diffs**, but you cannot **read** your committed
knowledge: the viewer only renders `git diff HEAD`, which is empty for a clean file — clicking a note
shows nothing. This increment closes that gap and adds hands-on file management.

**In scope:**
1. **Read + render** — selecting a file shows its **content as rendered markdown** (OKF body), with
   the OKF frontmatter surfaced as a compact header. When the file has pending changes, show the
   **diff** + Commit/Verwerp (today's behavior). Clean → rendered content; dirty → diff.
2. **Manual edit + new note** — an in-viewer **Edit** mode (raw markdown textarea → Save) and a
   **New note** action, both writing into the working tree (uncommitted) so they flow through the
   existing review → Commit/Verwerp path. A new note is scaffolded with minimal OKF frontmatter.
3. **Nav declutter** — hide the tool views (Integrations · Secrets · Artifacts) until at least one
   integration exists; always show **Vault** and **Capabilities**.

**Out of scope (later):** search across knowledge; run/conversation history; onboarding/empty-state
polish beyond the basics; packaging/quickstart; a rich WYSIWYG editor (a plain markdown textarea is
the v1 editor); all of #5 (OAuth/installer/tools).

## 2. Architecture

Small, additive. One new backend write route + a path-safe `workspace.writeFile`; the SPA Viewer
gains content-rendering + an edit mode; a New-note action; the TopBar conditionally hides the tool
triad. Writes are **review-mode** (uncommitted) — they reuse the existing `/api/commit` /
`/api/discard`. Markdown is rendered client-side with a small library (`marked`) + sanitization
(`dompurify`), since knowledge is OKF markdown.

## 3. Components / files

| Path | Change |
|---|---|
| `src/workspace.ts` | add `writeFile(relPath, content)` — path-safe (reuse the symlink-safe `safeResolve`), **knowledge-only** (reject `.git`/`integrations`/`artifacts`/`node_modules` first segment), `mkdir -p` parent, write |
| `src/dashboard/api.ts` | add `POST /api/file { path, content }` (session-authed) → `workspace.writeFile`; returns `{ ok: true }`. Leaves the change uncommitted. |
| `web/src/api.ts` | add `writeFile(path, content)` client method |
| `web/src/components/Viewer.tsx` | render markdown content for a clean file; keep diff for dirty; add an **Edit** toggle (textarea → Save via `writeFile`); show OKF frontmatter as a header |
| `web/src/views/VaultHome.tsx` | fetch file **content** (not just diff) on select; decide content-vs-diff by whether the selected path is in `status`; a **New note** action (prompt name → `writeFile` an OKF stub → select it in edit mode); refresh after save |
| `web/src/components/TopBar.tsx` | accept a `hasTools` flag; hide Integrations/Secrets/Artifacts when false |
| `web/src/App.tsx` | compute `hasTools` (e.g. `api.integrations()` non-empty) once after auth and pass to TopBar |
| `web/package.json` | add `marked` + `dompurify` (+ `@types/dompurify`) |
| tests | `workspace.writeFile` (path-safety + knowledge-only); the `POST /api/file` route; a client markdown-render unit test |

## 4. Data flow

- **Read:** select file → `GET /api/file?path=` → if the path is clean (not in `/api/status`),
  render the content as markdown in the viewer; if dirty, `GET /api/diff` and show the diff +
  Commit/Verwerp (today's path).
- **Edit:** Edit toggle → textarea seeded with `GET /api/file` content → Save → `POST /api/file
  {path, content}` (working tree, uncommitted) → the file becomes dirty → review → Commit/Verwerp.
- **New note:** New-note → prompt for a name → derive a kebab path (e.g. `notes/<name>.md`) →
  `POST /api/file` with an OKF stub (`---\ntype: note\ntitle: <name>\n---\n\n`) → select it → Edit
  mode → Save/Commit.
- **Nav:** after login, `hasTools = (await api.integrations()).length > 0`; TopBar shows the tool
  triad only when true.

## 5. Markdown rendering

`marked` (OKF body → HTML) piped through `dompurify` before injection (defense-in-depth even though
the content is the owner's own vault). The OKF frontmatter (`--- … ---`) is parsed off the top and
shown as a compact header (type/title/tags chips), not rendered as body. Emerald links + mono inline
code per the visual spec; reuse `app.css` classes.

## 6. Path safety (writes)

`workspace.writeFile` uses the same guard as `fileContent`/`diff` (symlink-safe `safeResolve` +
first-segment `HIDDEN_FIRST` rejection), so the dashboard can only write **knowledge** files inside
the vault — never `.git/`, `integrations/`, `artifacts/`, or outside the root. `POST /api/file`
returns `400` on a rejected path.

## 7. Error handling

- Write to a forbidden/traversal path → `400` (path-safety throw surfaced).
- `marked`/`dompurify` failure on a malformed file → fall back to showing the raw content in a `<pre>`
  (never a blank panel).
- Empty/whitespace content on New note → still allowed (an OKF stub is written); empty path → `400`.
- A new run while there are pending manual edits → blocked by the existing dirty-tree guard (Inc A).

## 8. Testing

- **Unit (backend):** `writeFile` writes within the vault; rejects `../`, symlink-escape, and
  `.git`/`integrations`/`artifacts` first segments; creates parent dirs. The `POST /api/file` route
  (session-guarded; writes; 400 on bad path).
- **Unit (client):** the markdown render+sanitize helper (a heading + link render; a `<script>` in
  content is stripped); the content-vs-diff selection logic.
- **Manual e2e** (extend `test/dashboard.e2e.manual.md`): select a committed note → see it rendered;
  Edit → change a line → Save → it shows as a diff → Commit; New note → it appears, edit + commit;
  with no integrations, the tool nav is hidden.

## 9. Out of scope / deferred
Search, run history, onboarding polish, packaging, rich editor → later. #5 (OAuth/installer/tools)
remains parked (see the parked-decisions memory). Multi-workspace (#6) unchanged.

# Dashboard (Increment A) E2E smoke (manual)

Needs a reachable model (`ANTHROPIC_API_KEY` or local Ollama). Build the SPA first: `cd web && npm run build && cd ..`.

1. `export GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=$(mktemp -d) GEODE_DASHBOARD_PASSWORD=pw`
2. `npm start` → console shows "Dashboard enabled at http://localhost:8787/".
3. Open `http://localhost:8787/` → the **login** screen. Wrong password → error; `pw` → the 3-pane Vault home.
4. In the chat: "Maak een notitie clients/test.md met één zin over deze vault."
   - Progress streams in the chat (SSE); a result change-card appears.
   - The new file appears in the tree with an emerald **nieuw** badge; selecting it shows a green-add **diff** in the viewer; the viewer shows **niet-gecommit** + Commit/Verwerp.
5. Click **Commit** → badges clear; `git -C $GEODE_WORKSPACE log --oneline` shows the commit. (Or **Verwerp** → the change disappears and the working tree is clean.)
6. Start another run while changes are pending → blocked until you Commit/Verwerp (the run resets a dirty tree at start; confirm you commit first).
7. Reload → still logged in (session cookie); `POST /api/logout` (or clear the cookie) → back to login.

## Increment B — ops views (manual)

(Build the SPA first; log in as in Increment A. Set a real integration + secret to exercise testing.)

8. Click **Capabilities** → see the derived menu (integrations + recipes). Empty vault → "nog geen…".
9. Add a sample integration: `cp examples/integrations/httpbin/manifest.json $GEODE_WORKSPACE/integrations/httpbin/manifest.json` (mkdir first). Click **Integrations** → `httpbin` listed with "0/1 secrets". Open it → see the `headers` action + required `DEMO_KEY` (ontbreekt).
10. Click **Secrets → Secret toevoegen**, name `DEMO_KEY` → a single-use link appears. Open it in a new tab → the §5.9 auth screen (shows `DEMO_KEY`, no value echoed). Enter a value → "opgeslagen in de broker". Reopen the same link → "verlopen of al gebruikt" (single-use).
11. Back in **Integrations → httpbin**, the secret now shows "gezet". Click **Test** on `headers` → a 200 result with the injected header echoed (proves invoke + server-side injection from the dashboard).
12. Produce an artifact (a `query` that writes to `artifacts/`), then **Artifacts** → see it; **Download** (session-authed) returns the file; **Deel-link** mints a signed public URL that works without auth.
13. Confirm no secret value is ever shown anywhere in the UI.

## Increment C — context files (manual)

(Build the SPA; log in as before.)

14. Select an existing committed note in the tree → it renders as **markdown** (frontmatter shown as a header chip), not an empty panel.
15. Click **Bewerk** → edit a line → **Opslaan** → the file shows as a **diff** (niet-gecommit) → **Commit** → re-selecting shows the updated rendered markdown.
16. Click **+ nieuw** in the Vault column → name it → a `notes/<slug>.md` OKF stub opens; edit + Opslaan + Commit → it appears in the tree.
17. With **no integrations** in the vault, the top-bar shows only **Vault** and **Capabilities** (Integrations/Secrets/Artifacts hidden). Add an integration manifest → reload → the tool nav appears.
18. A write to a forbidden path is rejected (e.g. via devtools `POST /api/file {path:"../x"}` → 400).

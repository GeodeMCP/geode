# Dashboard (Increment A) E2E smoke (manual)

Needs a reachable model (`ANTHROPIC_API_KEY` or local Ollama). Build the SPA first: `cd web && npm run build && cd ..`.

1. `export GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=$(mktemp -d) GEODE_DASHBOARD_PASSWORD=pw`
2. `npm start` → console shows "Dashboard enabled at http://localhost:8787/".
3. Open `http://localhost:8787/` → the **login** screen. Wrong password → error; `pw` → the 3-pane Vault home.
4. In the chat: "Create a note clients/test.md with one sentence about this vault."
   - Progress streams in the chat (SSE); a result change-card appears.
   - The new file appears in the tree with an emerald **new** badge; selecting it shows a green-add **diff** in the viewer; the viewer shows **uncommitted** + Commit/Discard.
5. Click **Commit** → badges clear; `git -C $GEODE_WORKSPACE log --oneline` shows the commit. (Or **Discard** → the change disappears and the working tree is clean.)
6. Start another run while changes are pending → the composer stays enabled and the run **accumulates** onto the existing draft (review-mode never resets the tree at start). Send a couple of follow-ups, then **Commit** once → all the changes land in a single commit; or **Discard** → the tree returns to HEAD.
7. Reload → still logged in (session cookie); `POST /api/logout` (or clear the cookie) → back to login.

## Increment B — ops views (manual)

(Build the SPA first; log in as in Increment A. Set a real integration + secret to exercise testing.)

8. Click **Capabilities** → see the derived menu (integrations + recipes). Empty vault → "No integrations yet." / "No recipes yet.".
9. Add a sample integration: `cp examples/integrations/httpbin/manifest.json $GEODE_WORKSPACE/integrations/httpbin/manifest.json` (mkdir first). Click **Integrations** → `httpbin` listed with "0/1 secrets". Open it → see the `headers` action + required `DEMO_KEY` (missing).
10. Click **Secrets → Add secret**, name `DEMO_KEY` → a single-use link appears. Open it in a new tab → the §5.9 auth screen (shows `DEMO_KEY`, no value echoed). Enter a value → "saved to the broker". Reopen the same link → "This link has expired or was already used." (single-use).
11. Back in **Integrations → httpbin**, the secret now shows "set". Click **Test** on `headers` → a 200 result with the injected header echoed (proves invoke + server-side injection from the dashboard).
12. Produce an artifact (a `query` that writes to `artifacts/`), then **Artifacts** → see it; **Download** (session-authed) returns the file; **Share link** mints a signed public URL that works without auth.
13. Confirm no secret value is ever shown anywhere in the UI.

## Increment C — context files (manual)

(Build the SPA; log in as before.)

14. Select an existing committed note in the tree → it renders as **markdown** (frontmatter shown as a header chip), not an empty panel.
15. Click **Edit** → edit a line → **Save** → the file shows as a **diff** (uncommitted) → **Commit** → re-selecting shows the updated rendered markdown.
16. Click **+ New** in the Vault column → name it → a `notes/<slug>.md` OKF stub opens; edit + Save + Commit → it appears in the tree.
17. With **no integrations** in the vault, the top-bar shows only **Vault** and **Capabilities** (Integrations/Secrets/Artifacts hidden). Add an integration manifest → reload → the tool nav appears.
18. A write to a forbidden path is rejected (e.g. via devtools `POST /api/file {path:"../x"}` → 400).

## Connect page (manual)

19. Click **Connect** (always visible in the nav, between Capabilities and Integrations). Left column shows two alternative methods separated by an "or" divider: **Add with a config (JSON)** ("Works now") and **Add with a URL** ("Setup required", disabled). Right rail lists the 4 tools (query / remember / list_capabilities / invoke) + a server-side secret-injection note.
20. The JSON shows the bearer token masked; click **reveal token** → the real token appears; **Copy** copies the full config with the real token. The CLI one-liner copies likewise.
21. The "Set up a public tunnel →" button is disabled (wires to sub-project C).

## Owner account & first-run (manual)

22. Fresh vault, no `GEODE_DASHBOARD_PASSWORD` → open `/` → "Create your vault" (email + password). Submit → logged in. Restart → email+password login works; wrong password trips a 429 after ~8 tries.
23. Env-fallback: set `GEODE_DASHBOARD_PASSWORD`, delete `~/.geode/account.json` → login is password-only (as before). While logged in, run setup (email + password) → an account is created and supersedes the env password on next login.
24. `npm run owner -- show` prints the owner email; `npm run owner -- reset` returns to first-run.

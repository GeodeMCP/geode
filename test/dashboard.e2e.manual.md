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

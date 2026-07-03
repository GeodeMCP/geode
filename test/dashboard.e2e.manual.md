# Dashboard (Increment A) E2E smoke (manual)

Needs a reachable model (`ANTHROPIC_API_KEY` or local Ollama). Build the SPA first: `cd web && npm run build && cd ..`.

1. `export GEODE_AUTH_TOKEN=t GEODE_WORKSPACE=$(mktemp -d)`. The dashboard always mounts; on first open with no owner you complete the **"Create your vault"** screen (email + password), or set `GEODE_OWNER_EMAIL`/`GEODE_OWNER_PASSWORD` to bootstrap the owner headlessly.
2. `npm start` → console shows "Dashboard enabled at http://localhost:8787/".
3. Open `http://localhost:8787/` → "Create your vault" (or, if an owner exists, the **login** screen). Complete setup / log in with your account email + password → the 3-pane Vault home.
4. In the chat: "Create a note clients/test.md with one sentence about this vault."
   - Progress streams in the chat (SSE); a result change-card appears.
   - The new file appears in the tree with an emerald **new** badge; selecting it shows a green-add **diff** in the viewer; the viewer shows **uncommitted** + Commit/Discard.
5. Click **Commit** → badges clear; `git -C $GEODE_WORKSPACE log --oneline` shows the commit. (Or **Discard** → the change disappears and the working tree is clean.)
6. Start another run while changes are pending → the composer stays enabled and the run **accumulates** onto the existing draft (review-mode never resets the tree at start). Send a couple of follow-ups, then **Commit** once → all the changes land in a single commit; or **Discard** → the tree returns to HEAD.
7. Reload → still logged in (session cookie); `POST /api/logout` (or clear the cookie) → back to login.

## Increment B — ops views (manual)

(Build the SPA first; log in as in Increment A. Set a real tool + secret to exercise testing.)

8. Click **Capabilities** → see the derived menu (tools + recipes). Empty vault → "No tools yet." / "No recipes yet.".
9. Add a sample tool: `cp examples/tools/httpbin/TOOL.md $GEODE_WORKSPACE/tools/httpbin/TOOL.md` (mkdir first). Click **Tools** → `httpbin` listed with "0/1 secrets". Open it → see the `headers` action + required `httpbin__default__DEMO_KEY` (missing).
10. Click **Secrets → Add secret**, name `httpbin__default__DEMO_KEY` → a single-use link appears. Open it in a new tab → the §5.9 auth screen (shows `httpbin__default__DEMO_KEY`, no value echoed). Enter a value → "saved to the broker". Reopen the same link → "This link has expired or was already used." (single-use).
11. Back in **Tools → httpbin**, the `default` connection now shows "configured". Click **Test** on `headers` → a 200 result with the injected header echoed (proves invoke + server-side injection from the dashboard).
12. Produce an artifact (a `query` that writes to `artifacts/`), then **Artifacts** → see it; **Download** (session-authed) returns the file; **Share link** mints a signed public URL that works without auth.
13. Confirm no secret value is ever shown anywhere in the UI.

## Increment C — context files (manual)

(Build the SPA; log in as before.)

14. Select an existing committed note in the tree → it renders as **markdown** (frontmatter shown as a header chip), not an empty panel.
15. Click **Edit** → edit a line → **Save** → the file shows as a **diff** (uncommitted) → **Commit** → re-selecting shows the updated rendered markdown.
16. Click **+ New** in the Vault column → name it → a `notes/<slug>.md` OKF stub opens; edit + Save + Commit → it appears in the tree.
17. With **no tools** in the vault, the top-bar shows only **Vault** and **Capabilities** (Tools/Secrets/Artifacts hidden). Add a tool manifest → reload → the tool nav appears.
18. A write to a forbidden path is rejected (e.g. via devtools `POST /api/file {path:"../x"}` → 400).

## Connect page (manual)

19. Click **Connect** (always visible in the nav, between Capabilities and Integrations). Left column shows two alternative methods separated by an "or" divider: **Add with a config (JSON)** ("Works now") and **Add with a URL** ("Setup required", disabled). Right rail lists the 4 tools (query / remember / list_capabilities / invoke) + a server-side secret-injection note.
20. The JSON shows the bearer token masked; click **reveal token** → the real token appears; **Copy** copies the full config with the real token. The CLI one-liner copies likewise.
21. The "Set up a public tunnel →" button is disabled (wires to sub-project C).

## Owner account & first-run (manual)

22. Fresh vault, no owner (`~/.geode/account.json` absent) → open `/` → "Create your vault" (email + password). Submit → logged in. Restart → email+password login works; wrong password trips a 429 after ~8 tries.
23. Env bootstrap: with no owner, set `GEODE_OWNER_EMAIL` + `GEODE_OWNER_PASSWORD` and `npm start` → on first boot a hashed owner is created from them (then they're inert) → open `/` → the **login** screen → sign in with that email + password.
24. `npm run owner -- show` prints the owner email; `npm run owner -- reset` removes the owner record and returns to first-run.

## Remote OAuth connector (manual)

25. `curl -s $BASE/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` return the metadata; `$BASE` derives from `GEODE_BASE_URL`.
26. `curl -i $BASE/mcp` with no auth → `401` + a `WWW-Authenticate: Bearer resource_metadata="…"` header. With `Authorization: Bearer $GEODE_AUTH_TOKEN` → not 401 (static bearer still works).
27. End-to-end against claude.ai (needs a public URL — use a throwaway `cloudflared`/`ngrok` and set `GEODE_BASE_URL` to it; create the owner first): Claude → Connectors → Add custom connector → paste the URL → it discovers metadata + self-registers (DCR) → opens the consent page → sign in with the owner account → Approve → connected. Confirm the 4 tools appear and a `query` runs over the OAuth token.
28. A forged/expired access token on `/mcp` → 401. Deny on the consent page → Claude shows the connection was declined.

## Upload intake (manual)

29. `curl -F file=@some.md $BASE/api/uploads` (with session cookie) returns `{uploadId}`; POST `/api/query` with `{instruction, uploadId}` and confirm the agent's transcript shows it Read the staged path.

# Dashboard mockups — canonical design reference

Preserved 2026-06-18 from the earlier brainstorm (2026-06-17) and the implemented
predecessor app, so the validated look is durable (these had only lived in the
gitignored `.superpowers/brainstorm/` sessions). These are the visual source of truth
for sub-project #4 (the dashboard), alongside `../geodemcp-visual-style.md` (the token
spec) and `../app.css` (the real CSS from the old `geodemcp` Flask app).

| File | What it is |
|---|---|
| `dashboard-home.html` | The validated **3-pane Vault home**: chat · file-tree · viewer with the commit/verwerp flow. Status: amber dot = modified, emerald "nieuw" badge = new file. |
| `dashboard-home-with-nav.html` | Same, **plus the top-bar nav** (Vault · Capabilities · Integraties · Secrets · Artifacts) agreed 2026-06-18. The current canonical home. |
| `connection-detail.html` | An opened integration/connection — where testing an action (`invoke`) lives. |
| `auth-screen.html` | The §5.9 secret-entry screen (human-facing front of the broker; signed single-use link). |
| `repo-install.html` | Integration install from a repo (belongs to #5, kept for continuity). |
| `dark-vs-light.html` | The dark-vs-light exploration (dark won). |

`../app.css` is the real stylesheet from `~/Projects/geodemcp/app/static/css/app.css` —
the fully tokenized source the visual-style spec refers to. Port tokens/components from
it when building #4 rather than re-deriving from prose.

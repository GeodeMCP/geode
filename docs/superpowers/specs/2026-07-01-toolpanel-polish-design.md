# ToolPanel polish — legible install-confirm + error states

**Slice:** 2A follow-up polish. The `ToolPanel` was extracted (2A) from the full-width Tools tab into the narrower Viewer column and reuses tab-era flex primitives (`.card`, `.pre`) as *vertical containers*, which breaks the install-confirm and error states.

**Goal:** Make the Install & trust flow legible in the viewer column — permissions fully readable, errors shown in a contained scrollable block, and the load-error surfaced as the *real* server message.

## The bugs (root cause: `.card` is a flex-row primitive)

`app.css`: `.card{ …; display:flex; align-items:center; }` and `.pre{ flex:1; overflow:auto; }`.

- **Install-confirm card** (`ToolPanel.tsx:60-75`) uses `<div className="card">` with no `display` override, so its children (eyebrow, permissions `<pre>`, description, buttons) render in a cramped **horizontal row**, and the permissions `<pre>` (`flex:1`) is squeezed so narrow that the `"network": "any"` line is clipped by `overflow` — the box looks empty (`{ }`). This defeats the *permissions review*: you can't read what you're trusting. (Verified: the data is correct — `permissions = {"network":"any"}` — purely a layout clip.)
- **Install error** (`:69`) renders as an inline `<p>` inside that same flex row, so a long multi-line `docker build failed: …` dump wraps chaotically across the strip.
- **Load error** (`:41`) is a boolean → a bare `<div className="pre">Tool not loaded — save the manifest first.</div>`, which (a) hides the *real* cause (e.g. the manifest failing `loadTool` validation) and (b) sits outside the panel container, looking bare.

## Changes — `web/src/components/ToolPanel.tsx` + `web/src/app.css`

### 1. Install-confirm card → vertical stack
Change the confirm card to a block container so its children stack and the permissions `<pre>` gets full width:
- `<div className="card" style={{ marginTop: 8, padding: "14px 16px" }}>` → add **`display: "block"`** to the inline style (keeps `.card`'s border/background/radius; overrides only the flex row). Children then stack: eyebrow → permissions (full width, legible) → note → buttons row (the buttons `<div>` keeps its own `display:flex`).

### 2. Reusable error block `.tp-error`
Add one CSS class and use it for both install and load errors:
```css
.tp-error{
  margin:8px 0; padding:10px 12px;
  border:1px solid rgba(248,113,113,.4); border-radius:8px; background:rgba(248,113,113,.06);
  color:#f8b4b4; font-family:"Geist Mono",monospace; font-size:12px; line-height:1.5;
  white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto;
}
```
- Install error (`:69`): `{installError && <pre className="tp-error">{installError}</pre>}`.
- Uninstall error (`:78`): same `.tp-error` block instead of the inline `<span>`.

### 3. Load error → real message, in the panel container
- Change state: `const [loadError, setLoadError] = useState("")` (string, not boolean).
- Capture the message in both load paths:
  - mount effect (`:17-19`): `.catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); })`; on success `setLoadError("")`.
  - `load()` (`:13`): `.catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))`; on success `setLoadError("")`.
- Render (replace `:41`) inside the panel container:
```tsx
if (loadError) return (
  <div className="toolpanel" style={{ overflow: "auto", padding: "20px 22px" }}>
    <div className="eyebrow" style={{ marginBottom: 8 }}>Couldn't load this tool</div>
    <pre className="tp-error">{loadError}</pre>
    <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 8 }}>Fix the manifest via Source / Edit and save — the panel reloads.</p>
  </div>
);
```
So an invalid manifest now shows e.g. `tool cloakbrowser: action "fetch" — command must be a non-empty array of argv tokens …` instead of the misleading "save the manifest first."

### 4. Light consistency
- Loading state (`:42`): wrap in the panel container — `<div className="toolpanel" style={{ padding: "20px 22px", color: "var(--faint)" }}>Loading…</div>`.
- Test-result `<pre>` (`:90`): add `maxHeight: 280` inline so a large result body doesn't run off the column (it already has `overflow:auto` via `.pre`).

No behavior beyond these; actions/connections *row* cards (which correctly set inline `display:flex`) are unchanged.

## Testing — `web/src/components/ToolPanel.test.tsx`
Add (and keep the existing 2A tests green):
- **Load error shows the real message:** mock `api.tool` to reject with `new Error("tool cb: action \"fetch\" — command must be a non-empty array of argv tokens")`; assert that text renders and "save the manifest first" does NOT.
- **Install error shows in the error block:** mock `installTool` to reject with a long multi-line message; drive Install & trust → Confirm install; assert the message text appears (in a `.tp-error` element).
- **Permissions are legible in the confirm card:** with `permissions: { network: "any" }`, after clicking Install & trust, assert the rendered confirm card contains `network` and `any` (the JSON is present, not clipped away in the DOM).

## Out of scope
- The `git clone` install failure (`buildDockerfile` runs `git clone` on a `python:3.12-slim`/`node:20-slim` base with no `git` → exit 127) — a real installer bug, fixed in a **separate** slice right after this one.
- Broader ToolPanel redesign; contextual per-connection secrets (2C-2).

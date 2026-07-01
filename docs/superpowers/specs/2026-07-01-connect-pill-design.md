# Dashboard 2C-1 — Connect as a top-right pill (nav-only change)

**Slice:** #2C-1 of the vault-centric dashboard redesign. Minimal, per Robbert: *"The pill is just a button to the current page… Same page as now, but the navigation to it only changes."*

**Goal:** Move **Connect** out of the left nav tab list into a **pill-shaped button in the top-right of the header** (connect icon + label). Clicking it opens the **existing Connect page, unchanged**. Nothing else changes.

## Scope (explicitly minimal)
- The Connect **page/view** (`web/src/views/Connect.tsx`) is **unchanged**.
- The `View` union and App routing (`{view === "Connect" && <Connect/>}`) are **unchanged** — Connect is still a routed view; only how you navigate to it changes.
- **Not in this slice:** removing the Secrets tab, contextual per-connection secrets, retiring the left nav. Those stay as-is.

## Change — `web/src/components/TopBar.tsx`

- Exclude `"Connect"` from the left-nav `items`:
  ```ts
  const items = VIEWS.filter((v) => (hasTools || ALWAYS.has(v)) && v !== "Connect");
  ```
  (`VIEWS` and `ALWAYS` are otherwise unchanged — Connect stays a valid `View`.)
- Render a **Connect pill** in the existing `.tb-right` cluster (before the `live` chip), with a connect/link icon, calling `onNav("Connect")`, and an `active` state when `view === "Connect"`:
  ```tsx
  <button className={`pill${view === "Connect" ? " active" : ""}`} onClick={() => onNav("Connect")} title="Connect a client">
    <ConnectIcon /> Connect
  </button>
  ```
- Add a small `ConnectIcon` SVG (a link/plug glyph in the existing 16×16 stroke style used by the tree icons).

## Styling — `web/src/app.css`
Add a `.pill` rule consistent with the dark emerald/blue system (rounded-full, subtle border, emerald accent on hover/active):
```css
.pill{ display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border:1px solid var(--border-strong); border-radius:999px; background:var(--surface-2); color:var(--neutral-200); cursor:pointer; font-size:13px; line-height:1; }
.pill:hover{ border-color:var(--emerald-500); color:var(--text); }
.pill.active{ border-color:var(--emerald-500); color:var(--emerald-300); }
.pill svg{ width:14px; height:14px; }
```

## Testing — `web/src/components/TopBar.test.tsx` (new; TopBar is currently untested)
- Renders the left nav WITHOUT a "Connect" item (Connect is not inside `<nav>`), and WITH "Vault".
- Renders a Connect **pill button** in the header; clicking it calls `onNav("Connect")`.
- The pill has the `active` class when `view="Connect"` and not when `view="Vault"`.
- (Guard) With `hasTools=true`, "Secrets" still appears in the left nav (unchanged gating).

## Out of scope
Everything beyond the Connect nav mechanism — see Scope above.

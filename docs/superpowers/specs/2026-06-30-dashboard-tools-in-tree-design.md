# Dashboard 2A — tools in the file-tree + dual (formatted + raw) tool viewer

**Slice:** #2A of the vault-centric dashboard redesign (resume-agenda item 2). Decomposed into 2A (tools in tree), 2B (artifacts in tree), 2C (Connect pill + secrets contextual). This is 2A.

**Goal:** A vault tool (`tools/<id>/TOOL.md`) appears in the dashboard file-tree with a distinct icon; clicking its manifest opens a viewer that offers the **formatted tool panel** (actions/Test, connections/configured, Install & trust/permissions, uninstall — overlaid live from `/api/tools/:id`) *and* the **raw manifest** (Source/Edit). The standalone Tools tab is removed.

## Why (the demo pain)

An agent-authored tool is written to `tools/<id>/TOOL.md`, but `knowledge.ts`'s `HIDDEN` set excludes `tools/`, so the tree has no node for it and the file "vanishes" — even though git status already reports it as `created` (untracked files are otherwise surfaced with a "new" badge). The fix is to stop hiding `tools/` and make the file-tree the single place tools live, replacing the separate Tools tab.

## What stays as-is (verified, not rebuilt)

- Untracked visibility already works: `statusPorcelain()` uses `-uall`; `parseStatus` puts `??`/`A` in `created`; `FileTree.tsx:58-59` renders **"new"**/**"modified"** badges. No change needed.
- The `/api/tools`, `/api/tools/:id`, `…/install`, `…/uninstall`, `…/test` routes and `ToolView` shape are reused unchanged. `loadTool` reads the manifest from disk regardless of git-tracking, so an untracked draft loads fine.

## Components changed

### Server — `src/dashboard/knowledge.ts` (one line)

Remove `"tools"` from `HIDDEN`:

```ts
const HIDDEN = new Set([".git", "artifacts", ".gitignore", "node_modules"]);
```

`artifacts` stays hidden (that's slice 2B). No `TreeNode` field is added — the client derives tool-ness from the path. (Tool dirs contain only the single tracked `TOOL.md`; the built image/binary lives outside the vault, so un-hiding `tools/` adds no bulk.)

### Client — tool path helper (`web/src/fileType.ts`)

Add a pure helper the tree + viewer share:

```ts
/** Returns the tool id when a path is a tool manifest (`tools/<id>/TOOL.md`), else null. */
export function toolManifestId(path: string): string | null {
  const m = /^tools\/([^/]+)\/TOOL\.md$/.exec(path);
  return m ? m[1] : null;
}
/** True when a tree path is anywhere under the `tools/` area (for the tool icon). */
export function isToolPath(path: string): boolean {
  return path === "tools" || path.startsWith("tools/");
}
```

### Client — `FileTree.tsx` (tool icon)

Add a `ToolIcon` glyph (a small plug/wrench in the existing 16×16 stroke style) and use it instead of `FolderIcon`/`FileIcon` when `isToolPath(n.path)`. Dirs keep their chevron; only the leading folder/file glyph swaps. Everything else (badges, delete, selection) is unchanged.

### Client — new `web/src/components/ToolPanel.tsx`

Extract the detail half of `Tools.tsx` (the `if (open)` block) into a self-contained `ToolPanel({ id }: { id: string })` that:
- loads `api.tool(id)` on mount / when `id` changes (and after install/uninstall) into local state; renders nothing-but-a-spinner/`null` until loaded, and a small "tool not loaded yet" line if `api.tool` 404s (an unsaved draft whose id is mid-edit).
- renders, verbatim from current `Tools.tsx`: name + `type` chip + installed chip; **Install & trust** → permissions-review card (`JSON.stringify(permissions)`) → Confirm install (builds image) / Cancel + `installError`; Uninstall when installed; **Actions** list each with **Test** (`api.testAction(id, action, {})`, result in `<pre>`); **Connections** list each with configured/needs-setup chip.
- owns the same local state Tools.tsx had: `result`, `confirmInstall`, `busy`, `installError`. The `← Tools` back button is dropped (there's no tab to go back to).

`ToolPanel` is the live overlay: install-state + connection-configured come from `/api/tools/:id` (the store + install record), **not** the manifest file.

### Client — `Viewer.tsx` (manifest → ToolPanel)

The Viewer gains a tool-manifest branch that takes precedence over the markdown/diff branches (a `TOOL.md` is a `.md` file, so without this it would render as plain markdown):

- `const toolId = path ? toolManifestId(path) : null;`
- The Formatted/Source segmented toggle shows for a tool manifest whenever `!editing` (not gated on `!dirty`, so a new/uncommitted tool still shows its panel).
- Render order when `toolId`:
  - `editing` → raw `CodeEditor` (editable) — saves the raw `TOOL.md` via the existing `onSave`.
  - `showSource` → raw `CodeEditor` (read-only) of `content`.
  - else → `<ToolPanel id={toolId} />` (Formatted) — **even when `dirty`**, so a freshly-authored manifest shows its panel rather than a git diff.
- The ColHead still shows the `uncommitted` indicator + Commit/Discard for a dirty manifest (unchanged), so the tool can be committed from here.
- Non-manifest files keep the exact current behavior (markdown formatted / diff-when-dirty / code).

Editing the raw manifest writes the file; server-side `loadTool` re-validates on next load. (Re-approval-on-permissions-change enforcement is **out of scope for 2A** — install/permissions review already lives in the ToolPanel; changing the manifest does not auto-trust anything.)

### Client — remove the Tools tab

- `TopBar.tsx`: `VIEWS = ["Vault", "Connect", "Secrets", "Artifacts"]` (drop `"Tools"`). `ALWAYS` unchanged; Secrets/Artifacts remain gated on `hasTools` (their removal is 2B/2C).
- `App.tsx`: drop the `Tools` import and the `{view === "Tools" && <Tools />}` route.
- Delete `web/src/views/Tools.tsx` (its detail logic now lives in `ToolPanel`; its list view is replaced by the tree). `App.tsx` still computes `hasTools` from `api.tools()` to gate the remaining tabs — keep that.

### Styling — `web/src/app.css`

Add a minimal rule for the tool glyph (e.g. `.ic.tool { color: var(--emerald-300); }`) and any spacing the `ToolPanel` needs when hosted inside the viewer column (it previously lived in a full-width tab with `padding: 24px 28px`; inside the viewer it should scroll within `.col.viewer`). Reuse existing `.card`/`.chip`/`.eyebrow`/`.pre` classes — no new design language.

## Data flow

1. `/api/tree` now includes `tools/<id>/TOOL.md`. `FileTree` renders it with the tool icon + a "new" badge if uncommitted.
2. Click → `VaultHome` sets `selected`, fetches `api.file(path)` (raw manifest text) as today.
3. `Viewer` sees `toolManifestId(path)` ≠ null → shows `<ToolPanel id={id} />`, which independently fetches `api.tool(id)` for the live overlay.
4. Install/Test/Uninstall happen inside `ToolPanel` via the existing routes; Source/Edit operate on the raw file via the existing `api.file`/`api.writeFile`.

## Testing

Server:
- `test/dashboard/knowledge.test.ts` — flip the existing assertion: the tree now **includes** a top-level `tools/` entry (with a `tools/<id>/TOOL.md` descendant) and still **excludes** `artifacts`, `.git`, `node_modules`, dotfiles.

Client (vitest + Testing Library, matching existing component tests):
- `fileType.test.ts` — `toolManifestId` matches `tools/x/TOOL.md` → `"x"`, rejects `tools/x/other.md`, `tools/TOOL.md`, `notes/TOOL.md`; `isToolPath` true for `tools` and `tools/...`, false otherwise.
- `components/FileTree.test.tsx` — a `tools/cloakbrowser/TOOL.md` node renders the tool icon (assert the tool glyph/class is present on that row and not on a plain note row).
- `components/ToolPanel.test.tsx` (new) — with `api.tool` mocked: renders actions + connections + installed chip; Install & trust reveals the permissions card and calls `api.installTool` then reloads; Test calls `api.testAction` and shows the result.
- `components/Viewer.test.tsx` — for a `tools/x/TOOL.md` path: Formatted renders the ToolPanel (mock `ToolPanel`/`api.tool`), Source shows the raw manifest text, the toggle switches; a dirty manifest still shows the panel (not a diff). Existing markdown/diff/json cases stay green.

## Out of scope (later slices / follow-ups)
- Artifacts in the tree + removing the Artifacts tab → **2B**.
- Connect pill + global secret admin + contextual per-connection secret set/clear + removing Connect/Secrets tabs → **2C**.
- Re-approval enforcement when an edit changes `permissions`/`source`.
- Inline "set this connection's secret" inside `ToolPanel` (that's the contextual-secrets piece of 2C; 2A shows configured/needs-setup status only, as today).

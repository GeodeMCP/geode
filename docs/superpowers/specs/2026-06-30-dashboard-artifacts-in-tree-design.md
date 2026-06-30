# Dashboard 2B — artifacts in the file-tree (API-sourced, generated-marked)

**Slice:** #2B of the vault-centric dashboard redesign (resume-agenda item 2). 2A (tools in tree) is merged. This is 2B; 2C (Connect pill + contextual/admin secrets) follows.

**Goal:** Generated artifacts appear as a dimmed, generated-marked `artifacts/` branch in the vault file-tree; clicking one opens a download + share panel in the viewer. The standalone Artifacts tab is removed.

## Why API-sourced, not filesystem-un-hidden

`config.artifactsDir` is `GEODE_ARTIFACTS_DIR || <workspace>/artifacts` (`config.ts:38`) — by default inside the vault (gitignored), but **relocatable outside it**. Artifacts are served by their own endpoints (`/api/artifacts`, `/api/artifacts/download`, `/api/artifacts/public-link`), keyed by paths relative to `artifactsDir`. Un-hiding `<vault>/artifacts` in `knowledge.ts` would therefore be wrong whenever `artifactsDir` is relocated, and would also make the tree's `/api/file` path diverge from the download endpoint.

So: **leave `HIDDEN` unchanged** (it still excludes `artifacts/` from the filesystem tree — no duplication) and **synthesize an `artifacts/` branch on the client from the `/api/artifacts` list**. This is robust to any `artifactsDir` location and reuses the authoritative artifact endpoints. **2B is client-only — no server change.**

## Components changed (all `web/src`)

### New util — `web/src/artifacts.ts`

```ts
import type { TreeNode } from "./api";

/** True when a tree path is the synthetic artifacts branch (`artifacts` or `artifacts/...`). */
export function isArtifactPath(path: string): boolean {
  return path === "artifacts" || path.startsWith("artifacts/");
}
/** Strips the synthetic `artifacts/` prefix to get the path relative to artifactsDir (for the artifact endpoints). */
export function artifactRelPath(path: string): string {
  return path.replace(/^artifacts\//, "");
}
/** Builds a nested TreeNode subtree (children of a synthetic `artifacts/` root) from artifactsDir-relative paths. */
export function buildArtifactTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const rel of paths) {
    const segs = rel.split("/");
    let level = root, prefix = "artifacts";
    segs.forEach((seg, i) => {
      prefix += "/" + seg;
      const isLeaf = i === segs.length - 1;
      let node = level.find((n) => n.name === seg);
      if (!node) {
        node = isLeaf ? { name: seg, path: prefix, type: "file" } : { name: seg, path: prefix, type: "dir", children: [] };
        level.push(node);
      }
      if (!isLeaf) level = node.children!;
    });
  }
  return root;
}
```

### `web/src/views/VaultHome.tsx`

- `refresh()` also fetches `api.artifacts()`; when non-empty, append a synthetic top-level node
  `{ name: "artifacts", path: "artifacts", type: "dir", children: buildArtifactTree(paths) }`
  to the tree returned by `api.tree()`. When there are zero artifacts, append nothing (no empty folder).
- The selected-file effect must **skip `api.file`/`api.diff` for artifact paths** (`isArtifactPath(selected)`), leaving `content`/`diff` empty — the Viewer renders the artifact panel instead, which fetches nothing on its own beyond the share action.
- `select` is unchanged (artifact nodes are selectable like any file).

### New component — `web/src/components/ArtifactPanel.tsx`

Ports the per-row actions from the old `Artifacts.tsx` for a single artifact:

```tsx
import { useState } from "react";
import { api } from "../api";

/** Viewer panel for one generated artifact: download + shareable public link. `path` is relative to artifactsDir. */
export function ArtifactPanel({ path }: { path: string }) {
  const [shared, setShared] = useState<string>("");
  const share = async () => { const { url } = await api.artifactPublicLink(path); setShared(url); };
  return (
    <div className="pre" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "var(--muted)" }}>Generated artifact — not part of the committed vault.</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="fname" style={{ flex: 1 }}>{path}</span>
        <a className="ghost" href={api.artifactDownload(path)} target="_blank" rel="noreferrer">Download</a>
        <button className="ghost" onClick={share}>Share link</button>
      </div>
      {shared && <input className="input" readOnly value={shared} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}
```

### `web/src/components/Viewer.tsx`

Add an artifact branch (takes precedence over the tool/markdown/code branches; an artifact path has no editable source here):
- `const artifact = path ? isArtifactPath(path) : false;`
- When `artifact`: render `<ArtifactPanel path={artifactRelPath(path)} />`; **suppress** the Formatted/Source toggle, the Edit button, and the dirty/commit controls (artifacts are gitignored — never dirty). ColHead shows the path + a small "generated" chip.
- Non-artifact paths keep their exact current behavior (tool manifest → ToolPanel, markdown, diff, code).

### `web/src/components/FileTree.tsx`

- Import `isArtifactPath`. Give artifact nodes a **dimmed/generated** treatment: render a distinct dimmed icon (reuse `FolderIcon`/`FileIcon` with a `gen` class) and add a `gen` modifier to the row so the label reads as generated (faint).
- **Suppress the trash/delete button** for artifact nodes (they are generated; deletion via `/api/file` would be wrong for a relocated `artifactsDir`). Selection still works.

### Remove the Artifacts tab

- `TopBar.tsx`: `VIEWS = ["Vault", "Connect", "Secrets"]` (drop `"Artifacts"`).
- `App.tsx`: drop the `Artifacts` import and the `{view === "Artifacts" && <Artifacts />}` route. Keep `hasTools` (still gates Secrets).
- Delete `web/src/views/Artifacts.tsx`. Confirm nothing imports `views/Artifacts`.

### Styling — `web/src/app.css`

Add a generated/dimmed treatment, e.g.:
```css
.row.gen .ic, .row.gen span{ color:var(--faint); }
.ic.gen{ color:var(--faint); }
```
(scope to win against `.row .ic` like the 2A tool-icon rule did). Reuse existing `.pre`/`.ghost`/`.input` classes — no new design language.

## Data flow

1. `VaultHome.refresh()` → `api.tree()` (no artifacts, `HIDDEN` excludes them) + `api.artifacts()` → synthetic `artifacts/` branch appended.
2. `FileTree` renders the artifacts branch dimmed, no trash.
3. Click an artifact → `selected = "artifacts/<rel>"`; VaultHome skips the file fetch; `Viewer` sees `isArtifactPath` → `<ArtifactPanel path={artifactRelPath(...)} />`.
4. Download/Share use the existing `/api/artifacts/*` endpoints with the artifactsDir-relative path.

## Testing

Client (vitest + Testing Library):
- `artifacts.test.ts` (new) — `buildArtifactTree(["a.md","sub/b.png","sub/c.txt"])` nests correctly (one `sub` dir with two children, paths `artifacts/sub/b.png` etc.); `isArtifactPath`/`artifactRelPath` cases; empty input → `[]`.
- `components/ArtifactPanel.test.tsx` (new) — renders the path + a Download anchor with `href` = `api.artifactDownload(path)`; Share calls `api.artifactPublicLink` and reveals the URL.
- `components/FileTree.test.tsx` — an `artifacts/report.md` node renders dimmed (the `gen` class) and has **no** trash button; a normal note row still has its trash button.
- `components/Viewer.test.tsx` — an `artifacts/report.md` path renders the ArtifactPanel (mock it), with no Formatted/Source toggle and no Edit button; non-artifact cases stay green.
- `views/VaultHome` is currently untested; add a focused test if feasible that `refresh` appends an `artifacts` node when `api.artifacts()` is non-empty and omits it when empty (mock `api`). If the existing harness makes a full VaultHome render heavy, cover the branch via the `buildArtifactTree`/append logic instead — do not skip the "omit when empty" assertion.

## Out of scope
- Deleting/renaming artifacts from the tree (generated outputs; managed by the runs that produce them).
- Rendering artifact contents inline (download is the interaction; a text-preview could be a later nicety).
- 2C: Connect pill + global secret admin + contextual per-connection secrets + removing Connect/Secrets tabs.

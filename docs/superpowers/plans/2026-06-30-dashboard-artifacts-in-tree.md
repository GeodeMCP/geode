# Dashboard 2B — artifacts in the file-tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generated artifacts appear as a dimmed `artifacts/` branch (sourced from `/api/artifacts`) in the vault tree; clicking one opens a download + share panel; the Artifacts tab is removed.

**Architecture:** Client-only. `HIDDEN` stays unchanged (no duplication). The client synthesizes an `artifacts/` branch from the authoritative `/api/artifacts` list, so it is robust to a relocated `artifactsDir`. Three tasks, each green.

**Tech Stack:** React + Vite + TypeScript, vitest + @testing-library/react (client tests run from `web/`).

**Spec:** `docs/superpowers/specs/2026-06-30-dashboard-artifacts-in-tree-design.md`

**Conventions:** terse existing style; husky gate runs eslint + JSDoc-on-exports + `tsc`. Exported fns/components need `/** … */`. Client tests: from `web/` → `npx vitest run`. There is NO server change in this slice.

---

### Task 1: `web/src/artifacts.ts` util + tests

**Files:** Create `web/src/artifacts.ts`, `web/src/artifacts.test.ts`.

- [ ] **Step 1: Write `artifacts.test.ts` (TDD)**
```ts
import { isArtifactPath, artifactRelPath, buildArtifactTree } from "./artifacts";

describe("isArtifactPath", () => {
  it("matches the synthetic branch", () => { expect(isArtifactPath("artifacts")).toBe(true); expect(isArtifactPath("artifacts/x.png")).toBe(true); });
  it("rejects others", () => { expect(isArtifactPath("notes/a.md")).toBe(false); expect(isArtifactPath("artifactsx")).toBe(false); });
});
describe("artifactRelPath", () => {
  it("strips the prefix", () => { expect(artifactRelPath("artifacts/sub/b.png")).toBe("sub/b.png"); expect(artifactRelPath("artifacts/a.md")).toBe("a.md"); });
});
describe("buildArtifactTree", () => {
  it("nests paths under artifacts/", () => {
    const t = buildArtifactTree(["a.md", "sub/b.png", "sub/c.txt"]);
    expect(t.map((n) => n.name).sort()).toEqual(["a.md", "sub"]);
    const sub = t.find((n) => n.name === "sub")!;
    expect(sub.type).toBe("dir");
    expect(sub.path).toBe("artifacts/sub");
    expect(sub.children!.map((n) => n.path).sort()).toEqual(["artifacts/sub/b.png", "artifacts/sub/c.txt"]);
    const leaf = t.find((n) => n.name === "a.md")!;
    expect(leaf.type).toBe("file"); expect(leaf.path).toBe("artifacts/a.md");
  });
  it("returns [] for no artifacts", () => { expect(buildArtifactTree([])).toEqual([]); });
});
```

- [ ] **Step 2: Run — fail.** From `web/`: `npx vitest run src/artifacts.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create `web/src/artifacts.ts`** (verbatim from the spec's util block: `isArtifactPath`, `artifactRelPath`, `buildArtifactTree`, each with JSDoc; import `TreeNode` from `./api`).

- [ ] **Step 4: Run — pass.** From `web/`: `npx vitest run src/artifacts.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add web/src/artifacts.ts web/src/artifacts.test.ts
git commit -m "feat(2B): artifacts tree util (synthetic branch + rel-path helpers)"
```

---

### Task 2: `ArtifactPanel` + VaultHome synthetic branch

**Files:** Create `web/src/components/ArtifactPanel.tsx`, `web/src/components/ArtifactPanel.test.tsx`; modify `web/src/views/VaultHome.tsx`.

- [ ] **Step 1: Write `ArtifactPanel.test.tsx` (TDD)**
```ts
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { vi } from "vitest";
import { ArtifactPanel } from "./ArtifactPanel";
import { api } from "../api";
vi.mock("../api", () => ({ api: { artifactDownload: (p: string) => `/api/artifacts/download?path=${p}`, artifactPublicLink: vi.fn() } }));
afterEach(cleanup);

it("shows the path + a download link", () => {
  render(<ArtifactPanel path="sub/b.png" />);
  expect(screen.getByText("sub/b.png")).toBeTruthy();
  const dl = screen.getByText("Download") as HTMLAnchorElement;
  expect(dl.getAttribute("href")).toContain("sub/b.png");
});
it("shares a public link", async () => {
  (api.artifactPublicLink as any).mockResolvedValue({ url: "https://x/share/abc" });
  render(<ArtifactPanel path="a.md" />);
  fireEvent.click(screen.getByText("Share link"));
  await waitFor(() => expect(api.artifactPublicLink).toHaveBeenCalledWith("a.md"));
  expect((await screen.findByDisplayValue("https://x/share/abc"))).toBeTruthy();
});
```

- [ ] **Step 2: Run — fail.** From `web/`: `npx vitest run src/components/ArtifactPanel.test.tsx` → FAIL.

- [ ] **Step 3: Create `web/src/components/ArtifactPanel.tsx`** (verbatim from the spec's ArtifactPanel block, with JSDoc).

- [ ] **Step 4: Run — pass.** From `web/`: `npx vitest run src/components/ArtifactPanel.test.tsx` → PASS.

- [ ] **Step 5: Wire the synthetic branch into `VaultHome.tsx`**

Import `isArtifactPath`, `buildArtifactTree` from `../artifacts`. Change `refresh`:
```ts
const refresh = useCallback(async () => {
  const [t, arts] = await Promise.all([api.tree(), api.artifacts()]);
  const tree = arts.length
    ? [...t, { name: "artifacts", path: "artifacts", type: "dir" as const, children: buildArtifactTree(arts.map((a) => a.path)) }]
    : t;
  setTree(tree);
  setStatus(await api.status());
}, []);
```
And in the selected-file effect, skip the file/diff fetch for artifacts:
```ts
useEffect(() => {
  if (!selected) { setContent(""); setDiff(""); return; }
  if (isArtifactPath(selected)) { setContent(""); setDiff(""); return; }
  api.file(selected).then((f) => setContent(f.content)).catch(() => setContent(""));
  if (status.modified.includes(selected) || status.created.includes(selected)) api.diff(selected).then((d) => setDiff(d.diff));
  else setDiff("");
}, [selected, status]);
```

- [ ] **Step 6: Typecheck.** From `web/`: `npx tsc --noEmit` → clean (the appended node must satisfy `TreeNode`; `type: "dir" as const`).

- [ ] **Step 7: Commit**
```bash
git add web/src/components/ArtifactPanel.tsx web/src/components/ArtifactPanel.test.tsx web/src/views/VaultHome.tsx
git commit -m "feat(2B): ArtifactPanel + synthetic artifacts branch in VaultHome"
```

---

### Task 3: Viewer + FileTree wiring; remove Artifacts tab

**Files:** Modify `web/src/components/Viewer.tsx`, `web/src/components/Viewer.test.tsx`, `web/src/components/FileTree.tsx`, `web/src/components/FileTree.test.tsx`, `web/src/app.css`, `web/src/components/TopBar.tsx`, `web/src/App.tsx`; delete `web/src/views/Artifacts.tsx`.

- [ ] **Step 1: Viewer test (TDD)**

In `web/src/components/Viewer.test.tsx`, mock ArtifactPanel to a sentinel and add: an `artifacts/report.md` path renders `artifactpanel`, with NO Formatted/Source toggle (`queryByText("Source")` null) and NO Edit button (`queryByText("Edit")` null). Existing tool/markdown/diff cases stay green.
```ts
vi.mock("./ArtifactPanel", () => ({ ArtifactPanel: ({ path }: { path: string }) => <div data-testid="artifactpanel">{path}</div> }));
```

- [ ] **Step 2: Run — fail.** From `web/`: `npx vitest run src/components/Viewer.test.tsx` → FAIL.

- [ ] **Step 3: Add the artifact branch to `Viewer.tsx`**

Import `ArtifactPanel` from `./ArtifactPanel`; import `isArtifactPath, artifactRelPath` from `../artifacts`. Compute `const artifact = path ? isArtifactPath(path) : false;`.
- Gate the toggle + Edit + commit controls off for artifacts: change `showToggle` to also require `!artifact`; wrap the `Edit`/`Discard`/`Commit` ColHead buttons so they don't render when `artifact`.
- Add the artifact branch as the FIRST non-editing render case (before `toolId`):
```tsx
{editing ? ( /* …unchanged… */ )
 : artifact ? <ArtifactPanel path={artifactRelPath(path!)} />
 : toolId ? ( /* …unchanged… */ )
 : dirty ? ( /* …unchanged… */ )
 : /* …rest unchanged… */ }
```
Add a small `generated` chip in ColHead when `artifact` (optional, for clarity).

- [ ] **Step 4: Run — pass.** From `web/`: `npx vitest run src/components/Viewer.test.tsx` → PASS.

- [ ] **Step 5: FileTree test (TDD)**

In `FileTree.test.tsx`, add: given a tree containing a synthetic `artifacts` dir node with an `artifacts/report.md` child and a normal `notes/a.md`, the artifact row carries the `gen` class (dimmed) and has NO `.del-btn` (trash); the note row DOES have a trash button.

- [ ] **Step 6: Run — fail.** From `web/`: `npx vitest run src/components/FileTree.test.tsx` → FAIL.

- [ ] **Step 7: FileTree dimming + suppress trash**

Import `isArtifactPath` from `../artifacts`. In `render`:
- add `gen` to the row className when `isArtifactPath(n.path)`: `className={`row ${isDir && open ? "open" : ""} ${selected === n.path ? "active" : ""} ${isArtifactPath(n.path) ? "gen" : ""}`}`.
- give artifact nodes a dimmed icon (e.g. add `gen` to the icon: reuse `FolderIcon`/`FileIcon` but render them with a `gen` className, or wrap). Simplest: keep the same glyph; the row `gen` class dims it via CSS.
- suppress the trash button for artifact nodes: only render the `del-btn` (and the confirm flow) when `!isArtifactPath(n.path)`.

- [ ] **Step 8: CSS** — add to `app.css` (scoped to win over `.row .ic`):
```css
.row.gen .lead span, .row.gen .ic{ color:var(--faint); }
```

- [ ] **Step 9: Remove the Artifacts tab**

`TopBar.tsx`: `VIEWS = ["Vault", "Connect", "Secrets"]`. `App.tsx`: drop the `Artifacts` import and `{view === "Artifacts" && <Artifacts />}` route (keep `hasTools`). Then `git rm web/src/views/Artifacts.tsx`. Confirm `grep -rn "views/Artifacts" web/src` → nothing.

- [ ] **Step 10: Full client suite + gate**

From `web/`: `npx vitest run && npx tsc --noEmit`. From root: `npx eslint web/src`. Expected: green; tsc clean; 0 eslint errors.

- [ ] **Step 11: Commit**
```bash
git add web/src/components/Viewer.tsx web/src/components/Viewer.test.tsx web/src/components/FileTree.tsx web/src/components/FileTree.test.tsx web/src/app.css web/src/components/TopBar.tsx web/src/App.tsx
git commit -m "feat(2B): Viewer artifact panel + dimmed tree nodes; remove Artifacts tab"
```

---

## Final verification

- From `web/`: `npx vitest run` green; `npx tsc --noEmit` clean.
- From root: `npx vitest run test/dashboard` green (no server change — should be untouched); `npx eslint web/src src test` clean.
- `grep -rn "views/Artifacts" web/src` → nothing.

# Dashboard 2A — tools in the file-tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tools/<id>/TOOL.md` appears in the file-tree with a distinct icon; clicking it shows the live formatted ToolPanel (actions/Test, connections, Install & trust, uninstall) plus raw Source/Edit; the standalone Tools tab is removed.

**Architecture:** Server stops hiding `tools/` (one line). The client derives tool-ness from the path (`tools/<id>/TOOL.md`). `Tools.tsx`'s detail rendering is extracted to a reusable `ToolPanel` the Viewer hosts for manifest paths. Three tasks, each leaving the build green.

**Tech Stack:** React + Vite + TypeScript, vitest + @testing-library/react (jsdom). Server: Express + Node, vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-dashboard-tools-in-tree-design.md`

**Conventions:** terse style matching existing components; husky pre-commit runs eslint + JSDoc-on-exports + `tsc`. New exported functions/components need a `/** … */`. Run server tests with `npx vitest run test/dashboard`, client tests with `npx vitest run` from `web/` (the web app has its own vitest config) — confirm by checking how existing tests run (`web/package.json` scripts).

---

### Task 1: Un-hide `tools/` + shared path helpers

**Files:**
- Modify: `src/dashboard/knowledge.ts:7`
- Modify: `test/dashboard/knowledge.test.ts`
- Modify: `web/src/fileType.ts`
- Modify: `web/src/fileType.test.ts`

- [ ] **Step 1: Flip the server test (TDD)**

In `test/dashboard/knowledge.test.ts`, find the assertion that the tree EXCLUDES `tools`. Change the fixture to also create `tools/cloakbrowser/TOOL.md` and assert the tree now INCLUDES a top-level node named `tools` (with that descendant), while still EXCLUDING `artifacts`, `.git`, `node_modules`, and dotfiles. (Match the file's existing temp-dir + `buildKnowledgeTree` pattern.)

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run test/dashboard/knowledge.test.ts`
Expected: FAIL (tools still hidden).

- [ ] **Step 3: Remove `tools` from HIDDEN**

`src/dashboard/knowledge.ts:7`:
```ts
const HIDDEN = new Set([".git", "artifacts", ".gitignore", "node_modules"]);
```

- [ ] **Step 4: Run server test — passes**

Run: `npx vitest run test/dashboard/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Add client helper tests (TDD)**

In `web/src/fileType.test.ts` add:
```ts
import { toolManifestId, isToolPath } from "./fileType";

describe("toolManifestId", () => {
  it("returns the id for a tool manifest", () => { expect(toolManifestId("tools/cloakbrowser/TOOL.md")).toBe("cloakbrowser"); });
  it("rejects non-manifest tool paths", () => {
    expect(toolManifestId("tools/cloakbrowser/other.md")).toBeNull();
    expect(toolManifestId("tools/TOOL.md")).toBeNull();
    expect(toolManifestId("notes/TOOL.md")).toBeNull();
  });
});
describe("isToolPath", () => {
  it("is true under tools/", () => { expect(isToolPath("tools")).toBe(true); expect(isToolPath("tools/x/TOOL.md")).toBe(true); });
  it("is false elsewhere", () => { expect(isToolPath("notes/a.md")).toBe(false); expect(isToolPath("toolsmith/a")).toBe(false); });
});
```

- [ ] **Step 6: Run — verify fail**

Run (from `web/`): `npx vitest run src/fileType.test.ts`
Expected: FAIL (helpers undefined).

- [ ] **Step 7: Add the helpers**

Append to `web/src/fileType.ts`:
```ts
/** Returns the tool id when a path is a tool manifest (`tools/<id>/TOOL.md`), else null. */
export function toolManifestId(path: string): string | null {
  const m = /^tools\/([^/]+)\/TOOL\.md$/.exec(path);
  return m ? m[1] : null;
}
/** True when a tree path is anywhere under the `tools/` area (used for the tool icon). */
export function isToolPath(path: string): boolean {
  return path === "tools" || path.startsWith("tools/");
}
```

- [ ] **Step 8: Run — passes**

Run (from `web/`): `npx vitest run src/fileType.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/knowledge.ts test/dashboard/knowledge.test.ts web/src/fileType.ts web/src/fileType.test.ts
git commit -m "feat(2A): show tools/ in the tree + tool-path helpers"
```

---

### Task 2: `ToolPanel` component + FileTree tool icon

**Files:**
- Create: `web/src/components/ToolPanel.tsx`
- Create: `web/src/components/ToolPanel.test.tsx`
- Modify: `web/src/components/FileTree.tsx`
- Modify: `web/src/components/FileTree.test.tsx`
- Modify: `web/src/app.css` (tool glyph color)

Leave `web/src/views/Tools.tsx` untouched in this task (still the live tab) — it is deleted in Task 3 once the tree path replaces it.

- [ ] **Step 1: Write `ToolPanel.test.tsx` (TDD)**

Match the existing component-test pattern (see `FileTree.test.tsx`/`Viewer.test.tsx`). Mock the `api` module:
```ts
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ToolPanel } from "./ToolPanel";
import { api } from "../api";

vi.mock("../api", () => ({ api: {
  tool: vi.fn(), installTool: vi.fn(), uninstallTool: vi.fn(), testAction: vi.fn(),
} }));

const TOOL = { id: "cb", name: "CloakBrowser", type: "cli", description: "d",
  actions: [{ name: "fetch" }], connections: [{ label: "default", configured: false }],
  requires: [], installed: false, permissions: { network: "any" } };

it("renders actions + connections + not-installed", async () => {
  (api.tool as any).mockResolvedValue(TOOL);
  render(<ToolPanel id="cb" />);
  expect(await screen.findByText("fetch")).toBeTruthy();
  expect(screen.getByText("default")).toBeTruthy();
  expect(screen.getByText("not installed")).toBeTruthy();
});

it("install & trust shows permissions then installs", async () => {
  (api.tool as any).mockResolvedValueOnce(TOOL).mockResolvedValueOnce({ ...TOOL, installed: true });
  (api.installTool as any).mockResolvedValue({});
  render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Install & trust"));
  expect(screen.getByText("Permissions requested")).toBeTruthy();
  fireEvent.click(screen.getByText("Confirm install"));
  await waitFor(() => expect(api.installTool).toHaveBeenCalledWith("cb"));
  expect(await screen.findByText("installed")).toBeTruthy();
});

it("Test calls the action and shows the result", async () => {
  (api.tool as any).mockResolvedValue(TOOL);
  (api.testAction as any).mockResolvedValue({ status: 200, body: "ok" });
  render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Test"));
  await waitFor(() => expect(api.testAction).toHaveBeenCalledWith("cb", "fetch", {}));
});
```

- [ ] **Step 2: Run — verify fail**

Run (from `web/`): `npx vitest run src/components/ToolPanel.test.tsx`
Expected: FAIL (no ToolPanel).

- [ ] **Step 3: Create `ToolPanel.tsx`**

Extract the `if (open)` detail block from `Tools.tsx`, parameterized by `id`, loading `api.tool(id)` itself, with the `← Tools` back button dropped:
```tsx
import { useEffect, useState } from "react";
import { api, type ToolView } from "../api";

/** Live formatted panel for one vault tool: install & trust, actions/test, connections — overlaid from /api/tools/:id (not the manifest file). */
export function ToolPanel({ id }: { id: string }) {
  const [tool, setTool] = useState<ToolView | null>(null);
  const [result, setResult] = useState("");
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState("");
  const [loadError, setLoadError] = useState(false);

  const load = () => api.tool(id).then((t) => { setTool(t); setLoadError(false); }).catch(() => setLoadError(true));
  useEffect(() => { setResult(""); setConfirmInstall(false); setInstallError(""); setTool(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const test = async (action: string) => {
    setResult("…");
    try { setResult(JSON.stringify(await api.testAction(id, action, {}), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };
  const install = async () => {
    setBusy(true); setInstallError("");
    try { await api.installTool(id); await load(); setConfirmInstall(false); }
    catch (e) { setInstallError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const uninstall = async () => {
    setBusy(true); setInstallError("");
    try { await api.uninstallTool(id); await load(); }
    catch (e) { setInstallError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (loadError) return <div className="pre"><div style={{ color: "var(--faint)" }}>Tool not loaded — save the manifest first.</div></div>;
  if (!tool) return <div className="pre"><div style={{ color: "var(--faint)" }}>Loading…</div></div>;
  const isCli = tool.type === "cli";
  const perms = tool.permissions;
  return (
    <div className="toolpanel" style={{ overflow: "auto", padding: "20px 22px" }}>
      <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em", marginTop: 0 }}>
        {tool.name} <span className="chip">{tool.type}</span>
        {isCli && (
          <span className="chip" style={tool.installed ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)", marginLeft: 6 } : { color: "var(--amber)", marginLeft: 6 }}>
            {tool.installed ? "installed" : "not installed"}
          </span>
        )}
      </h2>
      <p style={{ color: "var(--muted)" }}>{tool.description}</p>

      {isCli && !tool.installed && !confirmInstall && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setConfirmInstall(true)}>Install &amp; trust</button>
      )}
      {isCli && !tool.installed && confirmInstall && (
        <div className="card" style={{ marginTop: 8, padding: "14px 16px" }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Permissions requested</div>
          {perms ? (
            <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 10 }}>{JSON.stringify(perms, null, 2)}</pre>
          ) : (
            <p style={{ color: "var(--faint)", marginBottom: 10 }}>No special permissions declared.</p>
          )}
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>Confirming will build the Docker image and trust this tool with the permissions above.</p>
          {installError && <p style={{ color: "var(--red, #f87171)", fontSize: 13, marginBottom: 8 }}>{installError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" onClick={install} disabled={busy}>{busy ? "Installing…" : "Confirm install"}</button>
            <button className="ghost sm" onClick={() => { setConfirmInstall(false); setInstallError(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {isCli && tool.installed && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          {installError && <span style={{ color: "var(--red, #f87171)", fontSize: 13 }}>{installError}</span>}
          <button className="ghost sm" onClick={uninstall} disabled={busy}>{busy ? "Uninstalling…" : "Uninstall"}</button>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 16 }}>Actions</div>
      {tool.actions.map((a) => (
        <div key={a.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{a.name}</span>
          <button className="btn sm" onClick={() => test(a.name)}>Test</button>
        </div>
      ))}
      {result && <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10 }}>{result}</pre>}
      <div className="eyebrow" style={{ marginTop: 16 }}>Connections</div>
      {tool.connections.length === 0 && <p style={{ color: "var(--faint)" }}>No connections.</p>}
      {tool.connections.map((c) => (
        <div key={c.label} className="card" style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{c.label}{c.description ? ` — ${c.description}` : ""}</span>
          <span className="chip" style={c.configured ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>{c.configured ? "configured" : "needs setup"}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run — passes**

Run (from `web/`): `npx vitest run src/components/ToolPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: FileTree tool-icon test (TDD)**

In `web/src/components/FileTree.test.tsx`, add a test: given a tree with `notes/a.md` and `tools/cb/TOOL.md`, the tool manifest row renders an element with class `ic tool` and the note row does not. (Query via `container.querySelector(".ic.tool")` and assert it exists and sits within the tool row.)

- [ ] **Step 6: Run — verify fail**

Run (from `web/`): `npx vitest run src/components/FileTree.test.tsx`
Expected: FAIL (no tool icon yet).

- [ ] **Step 7: Add the tool icon to FileTree**

In `web/src/components/FileTree.tsx`: import `isToolPath` from `../fileType`; add a `ToolIcon`:
```tsx
const ToolIcon = () => (
  <svg className="ic tool" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.6 2.2a3 3 0 0 0-3.9 3.6L2.5 10a1.4 1.4 0 0 0 2 2l4.2-4.2a3 3 0 0 0 3.6-3.9l-1.8 1.8-1.5-.4-.4-1.5 1.8-1.8Z" />
  </svg>
);
```
and in `render`, swap the leading glyph:
```tsx
{isToolPath(n.path) ? <ToolIcon /> : isDir ? <FolderIcon /> : <FileIcon />}
```
(The chevron/spacer line above it is unchanged — tool dirs keep their expand chevron.)

- [ ] **Step 8: tool glyph color in `app.css`**

Add near the tree/icon rules:
```css
.ic.tool{ color:var(--emerald-300); }
```

- [ ] **Step 9: Run client tests — pass**

Run (from `web/`): `npx vitest run src/components/FileTree.test.tsx src/components/ToolPanel.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/ToolPanel.tsx web/src/components/ToolPanel.test.tsx web/src/components/FileTree.tsx web/src/components/FileTree.test.tsx web/src/app.css
git commit -m "feat(2A): ToolPanel component + tool icon in the file-tree"
```

---

### Task 3: Viewer manifest branch + remove the Tools tab

**Files:**
- Modify: `web/src/components/Viewer.tsx`
- Modify: `web/src/components/Viewer.test.tsx`
- Modify: `web/src/components/TopBar.tsx:5`
- Modify: `web/src/App.tsx`
- Delete: `web/src/views/Tools.tsx`

- [ ] **Step 1: Viewer test (TDD)**

In `web/src/components/Viewer.test.tsx`, mock `ToolPanel` to a sentinel and add cases for a `tools/cb/TOOL.md` path:
```ts
vi.mock("./ToolPanel", () => ({ ToolPanel: ({ id }: { id: string }) => <div data-testid="toolpanel">{id}</div> }));
```
- Formatted (default) for a tool manifest renders `toolpanel` with id `cb` (not markdown).
- Clicking the `Source` toggle renders the raw manifest text (the passed `content`) and not `toolpanel`.
- A **dirty** tool manifest (`dirty` prop true) still renders `toolpanel`, NOT a diff.
- A regular `notes/a.md` markdown file is unaffected (still renders formatted markdown; existing cases stay green).

- [ ] **Step 2: Run — verify fail**

Run (from `web/`): `npx vitest run src/components/Viewer.test.tsx`
Expected: FAIL (no tool branch).

- [ ] **Step 3: Add the tool-manifest branch to `Viewer.tsx`**

Import at top: `import { ToolPanel } from "./ToolPanel";` and add `toolManifestId` to the existing `../fileType` import. Then:

Compute `const toolId = path ? toolManifestId(path) : null;` near the other derived values.

Change `showToggle` so a tool manifest always offers Formatted/Source when not editing:
```ts
const showToggle = !!path && !editing && (toolId !== null || (!dirty && ft.hasFormatted));
```

Insert the tool branch as the FIRST non-editing case in the render conditional (before the `dirty ? …` branch):
```tsx
{editing ? (
  <CodeEditor value={draft} kind={ft.kind} editable onChange={setDraft} onSave={(text) => save(text)} onCancel={() => setEditing(false)} />
) : toolId ? (
  showSource
    ? <CodeEditor value={content} kind={ft.kind} editable={false} />
    : <ToolPanel id={toolId} />
) : dirty ? (
  /* …existing diff branch unchanged… */
) : path && ft.kind === "markdown" && !showSource ? (
  /* …existing markdown branch unchanged… */
) : path ? (
  /* …existing code branch unchanged… */
) : (
  /* …existing empty branch unchanged… */
)}
```
The Edit button (`!editing && path`) already opens the raw editor via `startEdit` (markdown kind → `content`), so editing a manifest writes the raw `TOOL.md` through the existing `onSave`. No other change.

- [ ] **Step 4: Run — passes**

Run (from `web/`): `npx vitest run src/components/Viewer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Remove the Tools tab**

`web/src/components/TopBar.tsx:5`:
```ts
export const VIEWS = ["Vault", "Connect", "Secrets", "Artifacts"] as const;
```
`web/src/App.tsx`: delete the `import { Tools } from "./views/Tools";` line and the `{view === "Tools" && <Tools />}` line. Leave the `hasTools` computation (it still gates Secrets/Artifacts).

- [ ] **Step 6: Delete the dead view**

```bash
git rm web/src/views/Tools.tsx
```
Confirm nothing else imports it: `grep -rn "views/Tools" web/src` → no results.

- [ ] **Step 7: Full client suite + typecheck/lint**

Run (from `web/`): `npx vitest run && npx tsc --noEmit`
Run (from repo root): `npx vitest run test/dashboard && npx eslint web/src src`
Expected: all green; no eslint errors; no references to the deleted Tools view.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/Viewer.tsx web/src/components/Viewer.test.tsx web/src/components/TopBar.tsx web/src/App.tsx
git commit -m "feat(2A): Viewer shows ToolPanel for manifests; remove Tools tab"
```

---

## Final verification (after all tasks)

- From `web/`: `npx vitest run` (client) green; `npx tsc --noEmit` clean.
- From root: `npx vitest run` (server) green; `npx eslint web/src src test` clean.
- Manual smoke (optional, documented in commit): start the kernel, open the dashboard, confirm a `tools/<id>/TOOL.md` shows in the tree with the tool icon, clicking it shows the ToolPanel (Install & trust/Test/Connections), Source shows the raw manifest, and there is no Tools tab.

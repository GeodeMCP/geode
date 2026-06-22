# Context-ready dashboard (Increment C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the dashboard usable for pure context files — read & render your knowledge as markdown, hand-edit and create notes (via review→commit), and hide the tool nav until tools exist.

**Architecture:** Additive. One path-safe, knowledge-only `workspace.writeFile` + a `POST /api/file` route (review-mode: leaves changes uncommitted). The SPA Viewer renders markdown for a clean file, keeps the diff for a dirty one, and gains an Edit mode; VaultHome fetches file content and adds a New-note action; the TopBar hides Integrations/Secrets/Artifacts until an integration exists. Markdown is rendered client-side with `marked` + `dompurify`.

**Tech Stack:** Existing kernel (Node/TS NodeNext ESM, express v5, vitest) + the `web/` React/Vite SPA. New web deps: `marked`, `dompurify` (+ `@types/dompurify`). Builds on merged dashboard (#4 A+B). Spec: `docs/superpowers/specs/2026-06-22-context-ready-dashboard-design.md`.

---

## File Structure
| Path | Change |
|---|---|
| `src/workspace.ts` (modify) | add `writeFile(relPath, content)` — reuse the async symlink-safe `safeResolve` (already rejects `.git`/`integrations`/`artifacts`/`node_modules` + traversal); `mkdir -p` parent; write |
| `src/dashboard/api.ts` (modify) | add `POST /file { path, content }` (session) → `workspace.writeFile`; 400 on bad path |
| `web/src/api.ts` (modify) | add `writeFile(path, content)` client method |
| `web/src/markdown.ts` (create) | `renderMarkdown(md)` (marked → dompurify) + `splitFrontmatter(md)` |
| `web/src/components/Viewer.tsx` (rewrite) | clean → rendered markdown (+ frontmatter header); dirty → diff; Edit mode (textarea → Save) |
| `web/src/views/VaultHome.tsx` (modify) | fetch file content on select; content-vs-diff; New-note action; save handler |
| `web/src/components/FileTree.tsx` (modify) | add a `onNew` "+ nieuw" action by the "Vault" eyebrow |
| `web/src/components/TopBar.tsx` (modify) | accept `hasTools`; hide Integrations/Secrets/Artifacts when false |
| `web/src/App.tsx` (modify) | compute `hasTools` and pass to TopBar |
| `web/package.json` (modify) | add `marked`, `dompurify`, `@types/dompurify` |
| tests | `workspace.writeFile`; `POST /api/file`; `web/src/markdown.test.ts` |

---

## Task 1: `workspace.writeFile` (path-safe, knowledge-only)

**Files:** modify `src/workspace.ts`; modify `test/workspace.dashboard.test.ts`.

- [ ] **Step 1: Add the failing test** — append to `test/workspace.dashboard.test.ts`:
```typescript
test("writeFile writes a knowledge file (creating parent dirs) and rejects machinery/traversal", async () => {
  const ws = createWorkspace(root); await ws.init();
  await ws.writeFile("notes/new.md", "# Hi\nbody\n");
  expect(await ws.fileContent("notes/new.md")).toContain("# Hi");
  await expect(ws.writeFile("../escape.md", "x")).rejects.toThrow(/outside|not allowed/);
  await expect(ws.writeFile(".git/hooks/evil", "x")).rejects.toThrow(/not allowed/);
  await expect(ws.writeFile("integrations/x/manifest.json", "{}")).rejects.toThrow(/not allowed/);
});
```
- [ ] **Step 2: Run** `npx vitest run test/workspace.dashboard.test.ts` → FAIL (`writeFile` missing).
- [ ] **Step 3: Implement** — in `src/workspace.ts`:

Extend the `node:fs/promises` import to include `writeFile as fsWriteFile` and `mkdir`:
```typescript
import { readFile, realpath, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
```
(Keep the existing `resolve, sep, dirname` import from `node:path`.) Add to the `Workspace` interface:
```typescript
  writeFile(relPath: string, content: string): Promise<void>;
```
Add the method to the returned object (uses the existing async `safeResolve`, which handles a not-yet-existing leaf via its ENOENT walk-up and rejects machinery dirs + traversal + symlink escape):
```typescript
    async writeFile(relPath, content) {
      const abs = await safeResolve(relPath);
      await mkdir(dirname(abs), { recursive: true });
      await fsWriteFile(abs, content, "utf8");
    },
```
- [ ] **Step 4: Run** `npx vitest run test/workspace.dashboard.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add src/workspace.ts test/workspace.dashboard.test.ts && git commit -m "feat(dashboard): workspace.writeFile (path-safe, knowledge-only)"`

---

## Task 2: `POST /api/file` route

**Files:** modify `src/dashboard/api.ts`; modify `test/dashboard/api.test.ts`.

- [ ] **Step 1: Add the failing test** — append inside `test/dashboard/api.test.ts` (it already boots an app with a real workspace + `login()` helper):
```typescript
test("POST /api/file writes a knowledge file (uncommitted); rejects traversal", async () => {
  const cookie = await login();
  const ok = await fetch(`${url}/api/file`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "notes/m.md", content: "# M\n" }) });
  expect((await ok.json()).ok).toBe(true);
  const f = await (await fetch(`${url}/api/file?path=notes/m.md`, { headers: { cookie } })).json();
  expect(f.content).toContain("# M");
  const bad = await fetch(`${url}/api/file`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ path: "../evil.md", content: "x" }) });
  expect(bad.status).toBe(400);
});
```
- [ ] **Step 2: Run** `npx vitest run test/dashboard/api.test.ts` → the new test FAILs (route missing → likely 404/SPA-fallback).
- [ ] **Step 3: Implement** — in `src/dashboard/api.ts`, add this route next to the existing `/file` GET (under `requireSession`):
```typescript
  router.post("/file", async (req, res) => {
    const path = String(req.body?.path ?? "");
    if (!path) { res.status(400).json({ error: "path required" }); return; }
    try { await deps.workspace.writeFile(path, String(req.body?.content ?? "")); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
```
- [ ] **Step 4: Run** `npx vitest run test/dashboard/api.test.ts` → PASS. Then `npm test` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `git add src/dashboard/api.ts test/dashboard/api.test.ts && git commit -m "feat(dashboard): POST /api/file (review-mode knowledge write)"`

---

## Task 3: SPA markdown helper + client write method

**Files:** create `web/src/markdown.ts`, `web/src/markdown.test.ts`; modify `web/src/api.ts`, `web/package.json`.

- [ ] **Step 1: Add deps** — `cd web && npm install marked dompurify && npm install -D @types/dompurify && cd ..`
- [ ] **Step 2: Add the failing test** — create `web/src/markdown.test.ts`:
```typescript
import { expect, test } from "vitest";
import { renderMarkdown, splitFrontmatter } from "./markdown";

test("renderMarkdown renders markdown and strips scripts", () => {
  const html = renderMarkdown("# Title\n\nHello **world**");
  expect(html).toContain("<h1");
  expect(html).toContain("<strong>world</strong>");
  expect(renderMarkdown("ok<script>alert(1)</script>")).not.toContain("<script>");
});

test("splitFrontmatter separates OKF frontmatter from the body", () => {
  const { fm, body } = splitFrontmatter("---\ntype: note\ntitle: X\n---\n\n# Body");
  expect(fm.type).toBe("note");
  expect(fm.title).toBe("X");
  expect(body.trim()).toBe("# Body");
  expect(splitFrontmatter("# No fm").fm).toEqual({});
});
```
- [ ] **Step 3: Run** `cd web && npx vitest run src/markdown.test.ts` → FAIL.
- [ ] **Step 4: Implement** — create `web/src/markdown.ts`:
```typescript
import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

export function splitFrontmatter(md: string): { fm: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: md.slice(m[0].length) };
}
```
Then add to `web/src/api.ts` inside the `api` object:
```typescript
  writeFile: (path: string, content: string) => json<{ ok: true }>("/api/file", { method: "POST", body: JSON.stringify({ path, content }) }),
```
- [ ] **Step 5: Run** `cd web && npx vitest run src/markdown.test.ts` → PASS. Then `cd web && npx tsc --noEmit`.
- [ ] **Step 6: Commit** `git add web/src/markdown.ts web/src/markdown.test.ts web/src/api.ts web/package.json web/package-lock.json && git commit -m "feat(dashboard): SPA markdown render/frontmatter helper + writeFile client"`

---

## Task 4: Viewer — render markdown + Edit mode

**Files:** rewrite `web/src/components/Viewer.tsx`.

- [ ] **Step 1: Rewrite `web/src/components/Viewer.tsx`:**
```tsx
import { useEffect, useState } from "react";
import { renderMarkdown, splitFrontmatter } from "../markdown";

export function Viewer({ path, content, diff, dirty, onCommit, onDiscard, onSave }: {
  path: string | null; content: string; diff: string; dirty: boolean;
  onCommit: () => void; onDiscard: () => void; onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => { setEditing(false); }, [path]);

  const startEdit = () => { setDraft(content); setEditing(true); };
  const save = () => { onSave(draft); setEditing(false); };
  const { fm, body } = splitFrontmatter(content);

  return (
    <div className="col viewer">
      <div className="panel-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="tl"><span /><span /><span /></div>
          <span className="fname">{path ?? "—"}</span>
          {dirty && <span className="uncommitted"><span className="dot-mod" />niet-gecommit</span>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {editing && <><button className="ghost sm" onClick={() => setEditing(false)}>Annuleer</button><button className="btn sm" onClick={save}>Opslaan</button></>}
          {!editing && path && <button className="ghost sm" onClick={startEdit}>Bewerk</button>}
          {!editing && dirty && <><button className="ghost sm" onClick={onDiscard}>Verwerp</button><button className="btn sm" onClick={onCommit}>Commit</button></>}
        </div>
      </div>

      {editing ? (
        <textarea className="input" style={{ flex: 1, margin: 16, fontFamily: "Geist Mono, monospace", fontSize: 13, resize: "none" }}
          value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      ) : dirty ? (
        <div className="pre">{diff
          ? diff.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : ""}>{l || " "}</div>)
          : <div style={{ color: "var(--faint)" }}>Geen wijzigingen.</div>}</div>
      ) : path ? (
        <div className="doc" style={{ overflow: "auto", padding: "18px 22px" }}>
          {(fm.title || fm.type || fm.tags) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {fm.type && <span className="chip">{fm.type}</span>}
              {fm.title && <span style={{ color: "var(--muted)", fontSize: 13 }}>{fm.title}</span>}
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        </div>
      ) : (
        <div className="pre"><div style={{ color: "var(--faint)" }}>Selecteer een bestand of stel de agent een vraag.</div></div>
      )}
    </div>
  );
}
```
(`.doc` is in `app.css` from the visual spec for prose; if absent, the inline padding still renders fine. `.btn.sm`/`.ghost.sm` were added in Increment B.)
- [ ] **Step 2: Build check** `cd web && npx tsc --noEmit` → will error until VaultHome passes the new props (Task 5). That's expected; proceed to Task 5 then build. (Do not commit a non-compiling tree — commit Task 4+5 together at the end of Task 5.)

---

## Task 5: VaultHome — fetch content, save, New note

**Files:** modify `web/src/views/VaultHome.tsx`, `web/src/components/FileTree.tsx`.

- [ ] **Step 1: Update `web/src/views/VaultHome.tsx`** — add content state, content-vs-diff fetch, save + newNote, and pass the new props:
```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent } from "../api";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { Viewer } from "../components/Viewer";

export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [diff, setDiff] = useState("");
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => { setTree(await api.tree()); setStatus(await api.status()); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!selected) { setContent(""); setDiff(""); return; }
    api.file(selected).then((f) => setContent(f.content)).catch(() => setContent(""));
    if (status.modified.includes(selected) || status.created.includes(selected)) api.diff(selected).then((d) => setDiff(d.diff));
    else setDiff("");
  }, [selected, status]);

  const dirty = status.modified.length + status.created.length > 0;

  const send = async (instruction: string, onEvent: (e: SseEvent) => void) => {
    setRunning(true);
    try {
      await api.run("/api/query", { instruction }, (e) => { onEvent(e); if (e.event === "result") { const f = e.data.filesTouched?.[0]; if (f) setSelected(f); } });
      await refresh();
    } finally { setRunning(false); }
  };
  const commit = async () => { await api.commit(); await refresh(); setDiff(""); };
  const discard = async () => { await api.discard(); await refresh(); setDiff(""); setSelected(null); };
  const save = async (text: string) => { if (!selected) return; await api.writeFile(selected, text); await refresh(); };
  const newNote = async () => {
    const name = window.prompt("Naam van de notitie")?.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "notitie";
    const path = `notes/${slug}.md`;
    await api.writeFile(path, `---\ntype: note\ntitle: ${name}\n---\n\n`);
    await refresh(); setSelected(path);
  };

  return (
    <div className="main">
      <Chat onSend={send} running={running} dirty={dirty} />
      <FileTree tree={tree} status={status} selected={selected} onSelect={setSelected} onNew={newNote} />
      <Viewer path={selected} content={content} diff={diff} dirty={dirty} onCommit={commit} onDiscard={discard} onSave={save} />
    </div>
  );
}
```
- [ ] **Step 2: Update `web/src/components/FileTree.tsx`** — add an `onNew` prop and a "+ nieuw" action by the eyebrow. Change the signature to include `onNew: () => void` and replace the eyebrow line with:
```tsx
      <div className="eyebrow" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Vault</span>
        <button className="ghost sm" onClick={onNew} style={{ textTransform: "none", letterSpacing: 0 }}>+ nieuw</button>
      </div>
```
(Keep the rest of FileTree unchanged.)
- [ ] **Step 3: Build** `cd web && npx tsc --noEmit && npm run build` → type-clean + builds.
- [ ] **Step 4: Commit** `git add web/src && git commit -m "feat(dashboard): read+render+edit files, New note (review→commit)"`

---

## Task 6: Nav declutter (hide tool views until tools exist)

**Files:** modify `web/src/components/TopBar.tsx`, `web/src/App.tsx`.

- [ ] **Step 1: `web/src/components/TopBar.tsx`** — add `hasTools` and filter the tool triad:
```tsx
export const VIEWS = ["Vault", "Capabilities", "Integrations", "Secrets", "Artifacts"] as const;
export type View = typeof VIEWS[number];
const ALWAYS = new Set<View>(["Vault", "Capabilities"]);
export function TopBar({ view, onNav, hasTools }: { view: View; onNav: (v: View) => void; hasTools: boolean }) {
  const items = VIEWS.filter((v) => hasTools || ALWAYS.has(v));
  return (
    <div className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="12,2 22,9 12,22" fill="#3FCFA1"/><polygon points="12,2 2,9 12,22" fill="#86ECCB"/><polygon points="2,9 12,22 22,9" fill="#4C7DF4" opacity=".85"/></svg>
        <span className="name">Geode</span>
        <span className="ws">personal-vault</span>
      </div>
      <nav>{items.map((v) => <a key={v} className={v === view ? "active" : ""} onClick={() => onNav(v)} style={{ cursor: "pointer" }}>{v}</a>)}</nav>
      <div className="tb-right"><span className="chip live"><span className="pulse" />live</span><span className="avatar" /></div>
    </div>
  );
}
```
- [ ] **Step 2: `web/src/App.tsx`** — compute `hasTools` after auth and pass it; keep the view on Vault by default:
```tsx
import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./views/Login";
import { TopBar, type View } from "./components/TopBar";
import { VaultHome } from "./views/VaultHome";
import { Capabilities } from "./views/Capabilities";
import { Integrations } from "./views/Integrations";
import { Secrets } from "./views/Secrets";
import { Artifacts } from "./views/Artifacts";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("Vault");
  const [hasTools, setHasTools] = useState(false);
  useEffect(() => { api.tree().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  useEffect(() => { if (authed) api.integrations().then((l) => setHasTools(l.length > 0)).catch(() => {}); }, [authed]);
  if (authed === null) return null;
  if (!authed) return <Login onIn={() => setAuthed(true)} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar view={view} onNav={setView} hasTools={hasTools} />
      {view === "Vault" && <VaultHome />}
      {view === "Capabilities" && <Capabilities />}
      {view === "Integrations" && <Integrations />}
      {view === "Secrets" && <Secrets />}
      {view === "Artifacts" && <Artifacts />}
    </div>
  );
}
```
- [ ] **Step 3: Build** `cd web && npx tsc --noEmit && npm run build` → type-clean + builds.
- [ ] **Step 4: Commit** `git add web/src && git commit -m "feat(dashboard): hide tool nav until an integration exists"`

---

## Task 7: Full verify + manual e2e

**Files:** modify `test/dashboard.e2e.manual.md`.

- [ ] **Step 1:** Repo root: `npm test` (all green) + `npx tsc --noEmit` (clean) + `npm run build`. Then `cd web && npx tsc --noEmit && npm run build && cd ..`.
- [ ] **Step 2:** Append an Increment-C section to `test/dashboard.e2e.manual.md`:
```markdown
## Increment C — context files (manual)

(Build the SPA; log in as before.)

14. Select an existing committed note in the tree → it renders as **markdown** (frontmatter shown as a header chip), not an empty panel.
15. Click **Bewerk** → edit a line → **Opslaan** → the file shows as a **diff** (niet-gecommit) → **Commit** → re-selecting shows the updated rendered markdown.
16. Click **+ nieuw** in the Vault column → name it → a `notes/<slug>.md` OKF stub opens; edit + Opslaan + Commit → it appears in the tree.
17. With **no integrations** in the vault, the top-bar shows only **Vault** and **Capabilities** (Integrations/Secrets/Artifacts hidden). Add an integration manifest → reload → the tool nav appears.
18. A write to a forbidden path is rejected (e.g. via devtools `POST /api/file {path:"../x"}` → 400).
```
- [ ] **Step 3:** Run the manual e2e once and fix anything that surfaces. **Step 4: Commit** `git add test/dashboard.e2e.manual.md && git commit -m "docs(dashboard): manual e2e for Increment C"`

---

## Notes for the implementer
- Writes are **review-mode**: `POST /api/file` never commits; the user commits via the existing Commit button (Increment A). The dirty-tree guard already blocks a new agent run while edits are pending.
- `workspace.writeFile` reuses the existing `safeResolve` — do not weaken it; it is the knowledge-only + symlink-safe guard.
- Markdown is the owner's own content; we still sanitize with `dompurify` (defense-in-depth) and never render raw HTML unsanitized.
- Keep exported names exact: `writeFile` (workspace + client), `renderMarkdown`/`splitFrontmatter`, `TopBar` (now takes `hasTools`).
- Tasks 4 and 5 must be committed together (the tree only compiles once VaultHome passes the Viewer's new props).

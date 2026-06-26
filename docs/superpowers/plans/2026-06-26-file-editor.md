# File Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard File Editor render each file type correctly, edit in a custom-themed CodeMirror 6 code editor (line numbers + syntax colour), and fix the awkward new-file creation flow.

**Architecture:** A single `CodeEditor` (CodeMirror 6) component powers both the read-only *Source/code* view and the editable *Edit* view, themed entirely from GeodeMCP design tokens. `Viewer.tsx` becomes a 3-state view (Formatted / Source / Edit) driven by a pure `fileType()` helper; Markdown keeps its rendered-prose path and dirty files keep the git-diff path. `FileTree.tsx` gets a dismissible new-file row and a global `.input:focus` ring fixes the stray browser outline app-wide.

**Tech Stack:** React 18 + Vite + TypeScript (strict), Vitest + @testing-library/react, CodeMirror 6 (`@codemirror/*`, `@lezer/highlight`).

**Spec:** `docs/superpowers/specs/2026-06-26-file-editor-design.md`

**Conventions:**
- Pre-commit gate (husky + lint-staged) requires **JSDoc on every top-level declaration** (`publicOnly: false`) or the commit is blocked — every exported *and* internal top-level function/const below has a `/** … */`.
- All UI strings English (memory `english-only-app-strings`).
- Web tests/build run from `web/`: `cd web && npx vitest run <file>`, `npm run build`, `npm run typecheck`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `web/src/fileType.ts` (new) | Pure helpers: `Kind`, `fileType()`, `prettyJson()`, `newFileDraft()`. |
| `web/src/editorTheme.ts` (new) | `geodeTheme` + `geodeHighlight` CodeMirror extensions from design tokens. |
| `web/src/components/CodeEditor.tsx` (new) | CodeMirror 6 React mount; read-only + editable. |
| `web/src/components/Viewer.tsx` (modify) | 3-state model; segmented toggle; uses `CodeEditor`. |
| `web/src/components/FileTree.tsx` (modify) | Dismissible new-file row; "+ New" active state. |
| `web/src/views/VaultHome.tsx` (modify) | `create()` uses `newFileDraft()`. |
| `web/src/app.css` (modify) | Global `.input:focus`; `.seg`, `.newfile-row`, `.cm-host`, "+ New" `.on`. |
| `web/package.json` (modify) | CodeMirror 6 dependencies. |

---

## Task 0: Branch + dependencies

**Files:**
- Modify: `web/package.json` (via npm install)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/file-editor
```

- [ ] **Step 2: Install CodeMirror 6 packages**

Run from the repo root:

```bash
cd web && npm install \
  @codemirror/state @codemirror/view @codemirror/commands @codemirror/language \
  @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-yaml @lezer/highlight
```

- [ ] **Step 3: Verify install + clean baseline**

Run: `cd web && npm run typecheck && npx vitest run`
Expected: typecheck passes; existing tests pass. `web/package.json` `dependencies` now lists the 8 packages.

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "build(web): add CodeMirror 6 dependencies"
```

---

## Task 1: `fileType.ts` pure helpers (TDD)

**Files:**
- Create: `web/src/fileType.ts`
- Test: `web/src/fileType.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/fileType.test.ts
import { describe, it, expect } from "vitest";
import { fileType, prettyJson, newFileDraft } from "./fileType";

describe("fileType", () => {
  it("classifies by extension", () => {
    expect(fileType("a.md")).toEqual({ kind: "markdown", hasFormatted: true });
    expect(fileType("notes/a.markdown")).toEqual({ kind: "markdown", hasFormatted: true });
    expect(fileType("a.json")).toEqual({ kind: "json", hasFormatted: false });
    expect(fileType("a.yaml")).toEqual({ kind: "yaml", hasFormatted: false });
    expect(fileType("a.yml")).toEqual({ kind: "yaml", hasFormatted: false });
    expect(fileType("a.txt")).toEqual({ kind: "text", hasFormatted: false });
    expect(fileType("README")).toEqual({ kind: "text", hasFormatted: false });
  });
});

describe("prettyJson", () => {
  it("indents valid JSON with 2 spaces", () => {
    expect(prettyJson('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
  });
  it("returns input unchanged when invalid", () => {
    expect(prettyJson("not json")).toBe("not json");
  });
});

describe("newFileDraft", () => {
  it("normalises path and defaults to .md with a note scaffold", () => {
    const r = newFileDraft("  /notes/idea ");
    expect(r).toEqual({ path: "notes/idea.md", draft: "---\ntype: note\ntitle: idea\n---\n\n" });
  });
  it("scaffolds {} for json", () => {
    expect(newFileDraft("data.json")).toEqual({ path: "data.json", draft: "{}" });
  });
  it("scaffolds empty for other extensions", () => {
    expect(newFileDraft("a.txt")).toEqual({ path: "a.txt", draft: "" });
  });
  it("returns null for blank input", () => {
    expect(newFileDraft("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/fileType.test.ts`
Expected: FAIL — `Failed to resolve import "./fileType"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/fileType.ts

/** A vault file's content kind, derived from its extension. */
export type Kind = "markdown" | "json" | "yaml" | "text";

/** Classifies a file path into a content kind and whether it has a rendered "formatted" form (Markdown only). */
export function fileType(path: string): { kind: Kind; hasFormatted: boolean } {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return { kind: "markdown", hasFormatted: true };
  if (ext === "json") return { kind: "json", hasFormatted: false };
  if (ext === "yaml" || ext === "yml") return { kind: "yaml", hasFormatted: false };
  return { kind: "text", hasFormatted: false };
}

/** Pretty-prints valid JSON with a 2-space indent; returns the input unchanged if it does not parse. */
export function prettyJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}

/** Builds the path + initial draft for a new file: trims/normalises the path, defaults the extension to .md, and scaffolds content by type. Returns null for blank input. */
export function newFileDraft(input: string): { path: string; draft: string } | null {
  let p = input.trim().replace(/^\/+/, "");
  if (!p) return null;
  if (!/\.[a-z0-9]+$/i.test(p)) p += ".md";
  const { kind } = fileType(p);
  if (kind === "markdown") {
    const title = p.replace(/\.[^.]+$/, "").split("/").pop() || "note";
    return { path: p, draft: `---\ntype: note\ntitle: ${title}\n---\n\n` };
  }
  if (kind === "json") return { path: p, draft: "{}" };
  return { path: p, draft: "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/fileType.test.ts`
Expected: PASS (3 describe blocks, 7 tests, all green).

- [ ] **Step 5: Commit**

```bash
git add web/src/fileType.ts web/src/fileType.test.ts
git commit -m "feat(web): add fileType/prettyJson/newFileDraft helpers"
```

---

## Task 2: `editorTheme.ts` (CodeMirror theme + highlight)

**Files:**
- Create: `web/src/editorTheme.ts`
- Test: `web/src/editorTheme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/editorTheme.test.ts
import { describe, it, expect } from "vitest";
import { geodeTheme, geodeHighlight } from "./editorTheme";

describe("editorTheme", () => {
  it("exports CodeMirror extensions", () => {
    expect(geodeTheme).toBeDefined();
    expect(geodeHighlight).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/editorTheme.test.ts`
Expected: FAIL — `Failed to resolve import "./editorTheme"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/editorTheme.ts
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/** CodeMirror view theme matching the GeodeMCP dashboard: transparent surface, hairline gutter, emerald caret/selection. */
export const geodeTheme: Extension = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#f2f2f2", height: "100%", fontSize: "13px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "'Geist Mono', monospace", lineHeight: "1.75", overflow: "auto" },
    ".cm-content": { caretColor: "#6ee7b7", padding: "12px 0" },
    ".cm-gutters": { backgroundColor: "transparent", color: "#555", border: "none", borderRight: "1px solid rgba(255,255,255,.07)" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#a3a3a3" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#6ee7b7" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(52,211,153,.18)" },
  },
  { dark: true },
);

/** Syntax token colours, mapped from the GeodeMCP palette (emerald keys, blue strings, amber numbers, violet literals). */
const geodeHighlightStyle = HighlightStyle.define([
  { tag: [t.propertyName, t.keyword], color: "#6ee7b7" },
  { tag: [t.string, t.special(t.string)], color: "#9fc0e8" },
  { tag: t.number, color: "#e0b072" },
  { tag: [t.bool, t.null, t.atom], color: "#c98fd0" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "#777" },
  { tag: t.heading, color: "#e0b072", fontWeight: "600" },
  { tag: [t.link, t.url], color: "#9fc0e8" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.comment, color: "#555", fontStyle: "italic" },
]);

/** Editor extension that applies the GeodeMCP syntax highlighting. */
export const geodeHighlight: Extension = syntaxHighlighting(geodeHighlightStyle);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/editorTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/editorTheme.ts web/src/editorTheme.test.ts
git commit -m "feat(web): add custom CodeMirror theme + highlight style"
```

---

## Task 3: `CodeEditor.tsx` (CodeMirror 6 React mount)

**Files:**
- Create: `web/src/components/CodeEditor.tsx`
- Test: `web/src/components/CodeEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/CodeEditor.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CodeEditor } from "./CodeEditor";

afterEach(cleanup);

describe("CodeEditor", () => {
  it("mounts a CodeMirror editor", () => {
    const { container } = render(<CodeEditor value="hello" kind="text" editable={false} />);
    expect(container.querySelector(".cm-host .cm-editor")).toBeTruthy();
  });
  it("is non-editable in read-only mode", () => {
    const { container } = render(<CodeEditor value="x" kind="json" editable={false} />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });
  it("is editable in edit mode", () => {
    const { container } = render(<CodeEditor value="x" kind="json" editable onChange={() => {}} />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/CodeEditor.test.tsx`
Expected: FAIL — `Failed to resolve import "./CodeEditor"`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/CodeEditor.tsx
import { useEffect, useRef } from "react";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { geodeTheme, geodeHighlight } from "../editorTheme";
import type { Kind } from "../fileType";

/** Returns the CodeMirror language extension for a content kind (none for plain text). */
function langFor(kind: Kind): Extension {
  if (kind === "json") return json();
  if (kind === "markdown") return markdown();
  if (kind === "yaml") return yaml();
  return [];
}

/** A custom-themed CodeMirror 6 editor used for both the read-only Source view and the editable Edit view. */
export function CodeEditor({ value, kind, editable, onChange, onSave, onCancel }: {
  value: string;
  kind: Kind;
  editable: boolean;
  onChange?: (text: string) => void;
  onSave?: (text: string) => void;
  onCancel?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Hold the latest callbacks so the editor doesn't rebuild when they change identity.
  const cb = useRef({ onChange, onSave, onCancel });
  cb.current = { onChange, onSave, onCancel };

  // Build (and rebuild) the editor when the language or edit-mode changes.
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(),
        history(), bracketMatching(),
        keymap.of([
          { key: "Mod-s", run: (v) => { cb.current.onSave?.(v.state.doc.toString()); return true; } },
          { key: "Escape", run: () => { cb.current.onCancel?.(); return true; } },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        langFor(kind), geodeTheme, geodeHighlight, EditorView.lineWrapping,
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
        EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange?.(u.state.doc.toString()); }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // value intentionally excluded — external value changes are handled by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, editable]);

  // Push external value changes (e.g. switching files) without clobbering in-progress typing.
  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div className="cm-host" ref={host} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/CodeEditor.test.tsx`
Expected: PASS. (If jsdom cannot resolve `.cm-content` contenteditable, relax those two assertions to `expect(container.querySelector(".cm-content")).toBeTruthy()` — the mount assertion is the primary smoke. Do not weaken further.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CodeEditor.tsx web/src/components/CodeEditor.test.tsx
git commit -m "feat(web): add CodeMirror CodeEditor component"
```

---

## Task 4: Rewrite `Viewer.tsx` to the 3-state model (TDD)

**Files:**
- Modify: `web/src/components/Viewer.tsx`
- Modify: `web/src/app.css` (add `.seg`, `.cm-host`)
- Test: `web/src/components/Viewer.test.tsx` (new)

- [ ] **Step 1: Add the CSS the viewer needs**

Append to `web/src/app.css` (after the `.doc-fm` rule, line ~178):

```css
  .seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;}
  .seg button{font-family:"Instrument Sans",sans-serif;font-size:12px;padding:4px 10px;background:transparent;border:none;color:var(--faint);cursor:pointer;}
  .seg button.on{background:var(--surface-2);color:var(--emerald-300);}
  .cm-host{flex:1;min-height:0;overflow:auto;}
```

- [ ] **Step 2: Write the failing test**

```tsx
// web/src/components/Viewer.test.tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Viewer } from "./Viewer";

afterEach(cleanup);

const noop = () => {};
const base = { diff: "", dirty: false, compose: null, onCommit: noop, onDiscard: noop, onSave: noop };

describe("Viewer", () => {
  it("renders Markdown formatted by default with a Formatted/Source toggle", () => {
    const { container, getByText } = render(
      <Viewer {...base} path="notes/a.md" content={"# Hello\n\nbody"} />,
    );
    expect(container.querySelector(".doc.md h1")?.textContent).toBe("Hello");
    expect(container.querySelector(".seg")).toBeTruthy();
    // toggling to Source swaps the prose for the code host
    fireEvent.click(getByText("Source"));
    expect(container.querySelector(".doc.md")).toBeFalsy();
    expect(container.querySelector(".cm-host")).toBeTruthy();
  });

  it("renders JSON as a code view with no toggle", () => {
    const { container } = render(
      <Viewer {...base} path="a.json" content={'{"a":1}'} />,
    );
    expect(container.querySelector(".seg")).toBeFalsy();
    expect(container.querySelector(".doc.md")).toBeFalsy();
    expect(container.querySelector(".cm-host")).toBeTruthy();
  });

  it("enters the editor on Edit", () => {
    const { container, getByText } = render(
      <Viewer {...base} path="a.json" content={"{}"} />,
    );
    fireEvent.click(getByText("Edit"));
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
    expect(getByText("Save")).toBeTruthy();
  });

  it("shows the git diff for a dirty file", () => {
    const { container } = render(
      <Viewer {...base} path="a.md" content={"x"} dirty diff={"@@ -1 +1 @@\n+x"} />,
    );
    expect(container.querySelector(".pre")).toBeTruthy();
    expect(container.querySelector(".cm-host")).toBeFalsy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run src/components/Viewer.test.tsx`
Expected: FAIL — current `Viewer` has no `.seg`/`.cm-host`; JSON renders through `.doc.md`.

- [ ] **Step 4: Replace `Viewer.tsx` with the 3-state implementation**

```tsx
// web/src/components/Viewer.tsx
import { useEffect, useState } from "react";
import { renderMarkdown, splitFrontmatter } from "../markdown";
import { fileType, prettyJson } from "../fileType";
import { CodeEditor } from "./CodeEditor";
import { ColHead } from "./ColHead";

/** Strips git plumbing header lines from a diff, keeping hunk headers and actual +/- change lines. */
function cleanDiff(diff: string): string[] {
  return diff.split("\n").filter((l) => !/^(diff --git |index [0-9a-f]|--- |\+\+\+ )/.test(l));
}

/** Renders the file viewer column: Formatted (Markdown) / Source (code) / Edit, plus the git diff for dirty files. */
export function Viewer({ path, content, diff, dirty, compose, onCommit, onDiscard, onSave }: {
  path: string | null; content: string; diff: string; dirty: boolean;
  compose: { path: string; draft: string } | null;
  onCommit: () => void; onDiscard: () => void; onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const ft = path ? fileType(path) : { kind: "text" as const, hasFormatted: false };

  // A brand-new note (compose) opens straight in the editor; selecting a file resets to the formatted/read view.
  useEffect(() => {
    if (compose && compose.path === path) { setDraft(compose.draft); setEditing(true); }
    else setEditing(false);
    setShowSource(false);
  }, [path, compose]);

  const codeText = ft.kind === "json" ? prettyJson(content) : content;
  const startEdit = () => { setDraft(ft.kind === "json" ? prettyJson(content) : content); setEditing(true); };
  const save = (text?: string) => {
    onSave(text ?? draft); setEditing(false); setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  const { fm, body } = splitFrontmatter(content);
  const showToggle = !!path && !editing && !dirty && ft.hasFormatted;

  return (
    <div className="col viewer">
      <ColHead title="File editor" note={path ?? "—"}>
        {dirty && <span className="uncommitted"><span className="dot-mod" />uncommitted</span>}
        {saved && <span style={{ color: "var(--green)", fontSize: 12.5 }}>Saved</span>}
        {showToggle && (
          <span className="seg">
            <button className={!showSource ? "on" : ""} onClick={() => setShowSource(false)}>Formatted</button>
            <button className={showSource ? "on" : ""} onClick={() => setShowSource(true)}>Source</button>
          </span>
        )}
        {editing && <><button className="ghost sm" onClick={() => setEditing(false)}>Cancel</button><button className="btn sm" onClick={() => save()}>Save</button></>}
        {!editing && path && <button className="ghost sm" onClick={startEdit}>Edit</button>}
        {!editing && dirty && <><button className="ghost sm" onClick={onDiscard}>Discard</button><button className="btn sm" onClick={onCommit}>Commit</button></>}
      </ColHead>

      {editing ? (
        <CodeEditor value={draft} kind={ft.kind} editable onChange={setDraft} onSave={(text) => save(text)} onCancel={() => setEditing(false)} />
      ) : dirty ? (
        <div className="pre">{(() => {
          const ls = cleanDiff(diff);
          return ls.length
            ? ls.map((l, i) => l.startsWith("@@")
              ? <div key={i} style={{ color: "var(--faint)" }}>{l}</div>
              : <div key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>{l || " "}</div>)
            : <div style={{ color: "var(--faint)" }}>No changes.</div>;
        })()}</div>
      ) : path && ft.kind === "markdown" && !showSource ? (
        <div className="doc md">
          {(fm.title || fm.type || fm.tags) && (
            <div className="doc-fm">
              {fm.type && <span className="chip">{fm.type}</span>}
              {fm.title && <span style={{ color: "var(--muted)", fontSize: 13 }}>{fm.title}</span>}
              {fm.tags && <span style={{ color: "var(--faint)", fontSize: 12 }}>{fm.tags}</span>}
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        </div>
      ) : path ? (
        <CodeEditor value={codeText} kind={ft.kind} editable={false} />
      ) : (
        <div className="pre"><div style={{ color: "var(--faint)" }}>Select a file or ask the agent.</div></div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/components/Viewer.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Viewer.tsx web/src/components/Viewer.test.tsx web/src/app.css
git commit -m "feat(web): 3-state File Editor (Formatted/Source/Edit) with CodeMirror"
```

---

## Task 5: New-file UX in `FileTree.tsx` + global focus ring (TDD)

**Files:**
- Modify: `web/src/components/FileTree.tsx`
- Modify: `web/src/components/FileTree.test.tsx`
- Modify: `web/src/app.css` (global `.input:focus`, `.newfile-row`, "+ New" `.on`)

- [ ] **Step 1: Add the CSS**

Append to `web/src/app.css` (after the `.input::placeholder` rule, line ~126):

```css
  .input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(52,211,153,.22);}
  .newfile-row{display:flex;align-items:center;gap:6px;padding:0 14px 8px;}
  .newfile-row .input{flex:1;}
  .ghost.sm.icon{padding:6px 9px;line-height:1;}
  .ghost.sm.on{color:var(--emerald-300);background:var(--surface-2);border-color:var(--border-strong);}
```

- [ ] **Step 2: Write the failing tests (extend the existing suite)**

Add these tests inside the existing `describe` in `web/src/components/FileTree.test.tsx` (keep all current tests). Use the existing render helper/props in that file; the snippet below assumes a `renderTree(props)` style — adapt to the file's existing setup:

```tsx
  it("opens and closes the new-file row", () => {
    const onCreate = vi.fn();
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
      <FileTree tree={[]} status={{ modified: [], created: [] }} selected={null}
        onSelect={() => {}} onCreate={onCreate} onDelete={() => {}} />,
    );
    fireEvent.click(getByText("+ New"));
    const input = getByPlaceholderText("path/to/note");
    // Escape closes
    fireEvent.keyDown(input, { key: "Escape" });
    expect(queryByPlaceholderText("path/to/note")).toBeNull();
  });

  it("creates on Enter and cancels on blur-when-empty", () => {
    const onCreate = vi.fn();
    const { getByText, getByPlaceholderText, getByTitle, queryByPlaceholderText } = render(
      <FileTree tree={[]} status={{ modified: [], created: [] }} selected={null}
        onSelect={() => {}} onCreate={onCreate} onDelete={() => {}} />,
    );
    fireEvent.click(getByText("+ New"));
    const input = getByPlaceholderText("path/to/note");
    fireEvent.change(input, { target: { value: "notes/x" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("notes/x");

    // reopen, blur empty → closes; ✕ exists while open
    fireEvent.click(getByText("+ New"));
    expect(getByTitle("Cancel")).toBeTruthy();
    fireEvent.blur(getByPlaceholderText("path/to/note"));
    expect(queryByPlaceholderText("path/to/note")).toBeNull();
  });
```

Ensure the test file imports `vi`, `fireEvent`, `render` from their current sources (top of the existing file already imports from `vitest` / `@testing-library/react`; add any missing names).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/FileTree.test.tsx`
Expected: FAIL — no `Cancel` ✕ button; blur does not close.

- [ ] **Step 4: Update `FileTree.tsx`**

Replace the create-state handlers and the create block. Change the `submitNew`/state area to add `cancelNew`:

```tsx
  const submitNew = () => { const v = name.trim(); if (!v) return; onCreate(v); setCreating(false); setName(""); };
  const cancelNew = () => { setCreating(false); setName(""); };
```

Replace the "+ New" button (in the `ColHead`) with the toggling, highlightable version:

```tsx
        <button className={`ghost sm${creating ? " on" : ""}`} onClick={() => (creating ? cancelNew() : setCreating(true))} style={{ textTransform: "none", letterSpacing: 0 }}>+ New</button>
```

Replace the `{creating && (...)}` block with the dismissible row:

```tsx
      {creating && (
        <div className="newfile-row">
          <input className="input" autoFocus value={name} placeholder="path/to/note"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitNew(); else if (e.key === "Escape") cancelNew(); }}
            onBlur={() => { if (!name.trim()) cancelNew(); }} />
          <button className="ghost sm icon" title="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancelNew}>✕</button>
        </div>
      )}
```

(`onMouseDown` preventDefault keeps focus so the ✕ click fires reliably even when the field has text.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/FileTree.test.tsx`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/FileTree.tsx web/src/components/FileTree.test.tsx web/src/app.css
git commit -m "feat(web): dismissible new-file row + global input focus ring"
```

---

## Task 6: Per-type scaffold in `VaultHome.tsx`

**Files:**
- Modify: `web/src/views/VaultHome.tsx`

- [ ] **Step 1: Import the helper**

Add to the imports at the top of `web/src/views/VaultHome.tsx`:

```tsx
import { newFileDraft } from "../fileType";
```

- [ ] **Step 2: Replace `create()`**

Replace the existing `create` function with:

```tsx
  const create = (input: string) => {
    const nf = newFileDraft(input);
    if (!nf) return;
    setCompose({ path: nf.path, draft: nf.draft });
    setSelected(nf.path);
  };
```

- [ ] **Step 3: Verify typecheck + full web suite**

Run: `cd web && npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests pass. (Confirms the old inline `.md`/frontmatter logic is fully replaced and nothing else referenced it.)

- [ ] **Step 4: Commit**

```bash
git add web/src/views/VaultHome.tsx
git commit -m "feat(web): scaffold new files by type (md/json/empty)"
```

---

## Task 7: Build + lint gate

**Files:** none (verification)

- [ ] **Step 1: Production build**

Run: `cd web && npm run build`
Expected: `tsc -b` clean, `vite build` succeeds (CodeMirror chunks emitted). No TypeScript errors.

- [ ] **Step 2: Lint (mirrors the pre-commit gate)**

Run from repo root: `npm run lint`
Expected: no errors. (If JSDoc errors appear on any new top-level declaration, add a `/** … */` — every export above already has one; check `langFor`, `geodeHighlightStyle`, `cleanDiff`.)

- [ ] **Step 3: Commit any build-tsbuildinfo churn (if tracked)**

```bash
git add -A && git commit -m "chore(web): build File Editor" || echo "nothing to commit"
```

---

## Task 8: Live validation

**Files:** none (manual)

- [ ] **Step 1: Build the SPA and restart the kernel**

```bash
cd web && npm run build
# from repo root, restart the kernel:
lsof -ti tcp:8787 | xargs kill 2>/dev/null; npx tsx --env-file=.env src/index.ts &
```

- [ ] **Step 2: Walk the checklist at http://localhost:8787/** (log in with the owner account)

- Open `experiments/experiment-data.json` → pretty-printed, line-numbered, **coloured**; **no** Formatted/Source toggle in the header.
- Open `notes/pricing-standup.md` → **Formatted** prose by default; click **Source** → coloured Markdown with line numbers; click **Edit** → code editor, type, `⌘S` saves ("Saved" flashes), `Esc` cancels.
- A file with uncommitted changes still shows the **git diff** (Discard/Commit).
- Click **+ New** → input shows a **soft emerald focus ring** (no white/blue outline); **✕**, **Esc**, and **click-away (empty)** all close it; "+ New" stays highlighted while open.
- Create `scratch.json` → opens the editor containing `{}`; create `idea` → becomes `idea.md` with the note frontmatter scaffold.

- [ ] **Step 3: Final commit (if anything changed) + summary**

```bash
git status   # expect clean
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** JSON read view (Task 4 + `prettyJson` Task 1) ✓; 3-state model (Task 4) ✓; CodeMirror custom theme (Tasks 2–3) ✓; same component read-only + editable (Task 3, used in Task 4) ✓; new-file dismissal + focus ring (Task 5) ✓; per-type scaffold (Tasks 1 + 6) ✓; dirty→diff preserved (Task 4 test) ✓; deps (Task 0) ✓; tests + live validation (Tasks 1–8) ✓.
- **Placeholders:** none — every code step contains complete code and exact commands.
- **Type consistency:** `Kind` defined in Task 1, consumed by `CodeEditor`/`Viewer`; `newFileDraft` shape `{path,draft}` matches `setCompose` in Task 6; `onSave(text)` signature consistent between `CodeEditor` (Task 3) and `Viewer` (Task 4).

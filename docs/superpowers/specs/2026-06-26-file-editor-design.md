# File Editor — Design

**Status:** approved via mockup iteration (`docs/design/mockups/file-editor-*.html`)
**Date:** 2026-06-26
**Area:** dashboard SPA (`web/src/`), viewer + file tree

## Problem

The dashboard's File Editor (the right "File editor" column) has three usability problems:

1. **Non-Markdown files render wrong.** `Viewer.tsx` pipes *every* file through `renderMarkdown()` (marked + DOMPurify). A `.json`/`.yaml`/`.txt` file is therefore parsed as Markdown and collapses into a single unformatted blob — no indentation, no line breaks, no line numbers. JSON is unreadable.
2. **The editor is a bare `<textarea>`** — monospace, but no line numbers and no syntax colour. It doesn't feel like a code editor.
3. **New-file creation is awkward.** `FileTree.tsx`'s "+ New" drops an inline input that can only be dismissed with `Esc` or by re-clicking "+ New" (no visible affordance), and the field shows the browser's **default white/blue focus outline** because `.input` has no `:focus` style in `app.css`. New files also always get a Markdown frontmatter scaffold, which makes a new `.json` invalid.

## Goal

A File Editor that renders each file type appropriately, offers a real (custom-themed) code editor with line numbers and syntax colour for editing and for source view, and a new-file flow that is easy to dismiss and visually consistent with the design system.

## Scope

In scope:
- **Per-type rendering** in the viewer, replacing the "everything is Markdown" path.
- A **3-state model** for the viewer (see below): Formatted / Source / Edit.
- A **CodeMirror 6**-based code editor (`CodeEditor` component), **fully custom-themed** to the GeodeMCP design system, used for both the read-only *Source/code* view and the editable *Edit* view.
- **New-file UX** fixes: themed focus ring (global), explicit cancel (✕), click-away + `Esc` to close, "+ New" highlighted while open, and **per-type scaffold**.

Out of scope (unchanged):
- The **dirty → diff** view (when a file has uncommitted changes the viewer shows the git diff with Discard/Commit). Behaviour preserved exactly; the Formatted/Source toggle governs the *clean* read view only.
- Chat panel, file tree structure/icons, commit/discard flow, the `query`/`remember` agent path.
- No multi-tab editing, no search/replace, no autosave. YAGNI.

## Decisions (locked through mockup review)

1. **Syntax colour, not plain.** JSON/non-Markdown read view and the editor both show **pretty-print + line numbers + syntax highlighting** (mockup option B), not monochrome.
2. **3-state viewer model.** For **Markdown**: default **Formatted** (rendered prose, as today) with a header segmented toggle to **Source** (raw + line numbers + colour). For **JSON / YAML / text**: there is no prose form, so the toggle is hidden and the file always shows the coloured **code** view. **Edit** opens the code editor for any type. `⌘S` save / `Esc` cancel unchanged.
3. **CodeMirror 6, custom-themed.** A real code editor (live colour while typing, line numbers, bracket matching, undo) themed entirely from design tokens via `EditorView.theme()` + a `HighlightStyle` — no stock CodeMirror look bleeds through. The **same component** powers the read-only Source/code view (`editable=false`) and the Edit view (`editable=true`), so highlighting is identical and defined once.
4. **New-file dismissal + focus ring.** The create input gains a ✕ cancel button; `Esc` and **blur-when-empty** also close it; "+ New" shows an active/highlighted state while open. The white/blue outline is fixed by a **global `.input:focus`** rule (soft emerald ring), so the harsh outline disappears app-wide (chat, login, setup) — same root cause.
5. **Per-type new-file scaffold.** `.md` → frontmatter scaffold (as now); `.json` → `{}`; everything else → empty. (Mockup option A.)
6. **Copy:** all UI strings English (per memory `english-only-app-strings`).

## Viewer state model

Two pieces of local state in `Viewer.tsx`: `editing: boolean` (exists today) and `showSource: boolean` (new; only meaningful for Markdown). Reset both when `path` changes (selecting a file → Formatted/view).

| Condition (in priority order) | Renders |
|---|---|
| `editing` | editable `<CodeEditor>` (line numbers, colour) |
| `dirty` (uncommitted) | git diff view — **unchanged** |
| clean · `kind==='markdown'` · `!showSource` | Formatted prose (`marked` + frontmatter chips) — as today |
| clean · `path` · (non-markdown **or** `showSource`) | read-only `<CodeEditor>` (code view) |
| no `path` | "Select a file or ask the agent." — unchanged |

Header controls:
- **Segmented `Formatted | Source`** toggle: shown only when `path && !editing && !dirty && kind==='markdown'`.
- `Edit` button: shown when `!editing && path` (unchanged).
- `Cancel`/`Save`: shown when `editing` (unchanged).
- `Discard`/`Commit`: shown when `!editing && dirty` (unchanged).

## File-type detection

A pure helper (new `web/src/fileType.ts`):

```ts
type Kind = "markdown" | "json" | "yaml" | "text";
interface FileType { kind: Kind; hasFormatted: boolean; } // hasFormatted true only for markdown
function fileType(path: string): FileType   // by extension: .md/.markdown→markdown; .json→json; .yaml/.yml→yaml; else→text
function prettyJson(text: string): string   // JSON.parse → JSON.stringify(v,null,2); returns text unchanged if parse fails
```

The CodeMirror language extension is selected from `kind` inside `CodeEditor` (keeps language imports in one place). `prettyJson` is applied to a `.json` file's content **before display** in both the code view and on entering Edit; **save writes the editor content verbatim** (so a deliberately-minified file that the user opens and saves will be reformatted — acceptable for human-edited vault files, and surfaced as a normal diff).

## CodeMirror integration

New component `web/src/components/CodeEditor.tsx` — a thin React mount around CodeMirror 6 (no `@uiw/react-codemirror` wrapper; we control the setup directly, per "custom enough to fit our design"):

```tsx
function CodeEditor(props: {
  value: string;
  kind: Kind;
  editable: boolean;
  onChange?: (text: string) => void;   // editable only
  onSave?: () => void;                  // ⌘S
  onCancel?: () => void;                // Esc
}): JSX.Element
```

- Mounts an `EditorView` in a `useRef` div on first render; tears down on unmount.
- **Reconfiguration** via CodeMirror `Compartment`s for `editable`, `language`, and the read-only flag, so toggling Source→Edit or switching files doesn't require a full remount; external `value` changes are pushed with a `dispatch` only when they differ from the doc (guards typing loops).
- **Extensions:** `lineNumbers()`, `highlightActiveLine()`, `history()`, bracket matching, `keymap.of([...defaultKeymap, ...historyKeymap, {key:"Mod-s", run:()=>{onSave?.();return true}}, {key:"Escape", run:()=>{onCancel?.();return true}}])`, the language compartment, `geodeTheme`, `syntaxHighlighting(geodeHighlight)`, and `EditorView.lineWrapping` for markdown/text. Read-only mode adds `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)` and drops the edit keymaps.

**Theme (design-system match).** `web/src/editorTheme.ts`:
- `geodeTheme = EditorView.theme({...}, {dark:true})` setting background to transparent/`var(--bg)`, the gutter to `var(--faint)` on a hairline border, the active line, the selection, and the caret (`var(--emerald-300)`) — values reference existing CSS variables so it tracks the design system.
- `geodeHighlight = HighlightStyle.define([...])` mapping `@lezer/highlight` tags to tokens: `propertyName`/`keyword` → emerald (`var(--emerald-300)`), `string` → blue, `number` → amber, `bool/null` → violet, `punctuation/separator` → `var(--faint)`, headings/`heading` (markdown) → amber-ish, `link`/`url` → blue. Matches the colours shown in the approved mockups.

**Packages** (added to `web/package.json`; the plan pins exact versions, verifying current API via context7): `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-json`, `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, `@lezer/highlight`.

## New-file UX (`FileTree.tsx` + `VaultHome.tsx`)

`FileTree.tsx`:
- Create row becomes `input` + ✕ button (`.newfile-row`). Handlers: `Enter` → submit, `Esc` → cancel, `onBlur` → cancel **only if the field is empty** (so click-away dismisses an untouched field without discarding typed input); ✕ → always cancel.
- "+ New" button gets an `on` class while `creating` is true (highlighted state).

`VaultHome.tsx` `create(input)`:
- Keep "append `.md` if no extension" behaviour.
- Replace the always-Markdown scaffold + inline path-normalisation with `newFileDraft(input)` (the as-built superset of `scaffoldFor`): it trims/normalises the path, defaults the extension to `.md`, and returns `{ path, draft }` — `.md` → `---\ntype: note\ntitle: <name>\n---\n\n`; `.json` → `{}`; else → `""`; returns `null` for blank input. (Helper lives in `fileType.ts`.)

`app.css`:
- **Global** `.input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(52,211,153,.22);}` (token `--green:#34d399`) — the central fix.
- `.seg` segmented toggle styles (idle/active), `.newfile-row` layout, ✕ button, "+ New" `.on` state, and a `.cm-host` flex wrapper so CodeMirror fills the column (`flex:1; min-height:0; overflow:auto`). CodeMirror supplies its own internal colours via the JS theme.

## Components touched

| File | Change |
|------|--------|
| `web/src/fileType.ts` (new) | `Kind`, `fileType(path)`, `prettyJson(text)`, `newFileDraft(input)`. Pure, unit-tested. |
| `web/src/editorTheme.ts` (new) | `geodeTheme` + `geodeHighlight` from design tokens. |
| `web/src/components/CodeEditor.tsx` (new) | CodeMirror 6 React mount; read-only + editable via compartments. |
| `web/src/components/Viewer.tsx` | 3-state model; segmented toggle; use `CodeEditor` for Source + Edit; keep Formatted (markdown) and diff (dirty) paths. Drop the `<textarea>`. |
| `web/src/components/FileTree.tsx` | New-file row: ✕ cancel, blur-when-empty, `Esc`; "+ New" active state. |
| `web/src/views/VaultHome.tsx` | `create()` uses `newFileDraft(input)`. |
| `web/src/app.css` | Global `.input:focus` ring; `.seg`, `.newfile-row`, ✕, "+ New" `.on`, `.cm-host`. |
| `web/package.json` | Add CodeMirror 6 packages. |

## Testing

- `web/src/fileType.test.ts`: `fileType()` maps extensions correctly (md/markdown/json/yaml/yml/unknown); `prettyJson()` indents valid JSON and returns input unchanged on invalid JSON; `newFileDraft()` returns frontmatter for `.md`, `{}` for `.json`, empty otherwise, and `null` for blank input.
- `web/src/components/Viewer.test.tsx` (new): markdown clean file shows Formatted by default and the toggle switches to a code view; a `.json` file shows the code view and **no** Formatted/Source toggle; clicking Edit enters the editor; dirty file still shows the diff. (CodeMirror treated as a black box — assert the host renders and that a `.json` shows pretty-printed text content, not Markdown HTML.)
- `web/src/components/FileTree.test.tsx` (extend): "+ New" reveals the row; ✕ and `Esc` close it; blur with empty field closes, blur with text keeps it; submit calls `onCreate` with the typed path.
- Keep existing tests green (`web/src/api.test.ts`, `markdown.test.ts`, `FileTree.test.tsx`, etc.).

## Live validation

Build the SPA (`cd web && npm run build`), restart the kernel, open `/`, log in:
- Open `experiments/experiment-data.json` → pretty-printed, line-numbered, coloured; no Formatted/Source toggle.
- Open `notes/pricing-standup.md` → Formatted prose; toggle to Source → coloured Markdown with line numbers; Edit → code editor, type, `⌘S` saves, `Esc` cancels.
- "+ New" → input with soft emerald focus ring (no white/blue outline); ✕ / `Esc` / click-away all close it; create `x.json` → opens editor containing `{}`.

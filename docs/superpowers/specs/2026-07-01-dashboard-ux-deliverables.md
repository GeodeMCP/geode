# Dashboard & Caller UX — Deliverables Checklist

_Date: 2026-07-01 · Source: user feedback dump + grounded code exploration._

This is the checkable backlog extracted from the UX/UI feedback. Each item has an
explicit verification criterion. Items are ordered lowest-hanging-fruit first.
Two items (B7, B8) are deferred to their own specs because they are not yet
defined enough to be verifiable.

## Design principles / constraints (apply to every item)

- **UI strings are English.** Chat with the agent stays Dutch; code and UI copy do not.
- **Visual & interaction work routes through `/frontend-design`.** Target: no more
  "green rectangles with green borders" — no ad-hoc inline styles, no `JSON.stringify`
  dumps in `<pre>`.
- **Attachments are run-context, not vault content** — never auto-committed into the vault.
- **No fake status.** Any indicator shown must be backed by real data or removed.

---

## A. Checkable deliverables

### Polish sweep (can run in parallel)

- [ ] **D1 — Folders collapsed by default** · _S_
  `web/src/components/FileTree.tsx` (the `collapsed` set starts empty → all open).
  **Verify:** fresh load of Vault → no folder shows its children until clicked.

- [ ] **D2 — Persist expand/collapse state across refresh** · _S_
  localStorage (there is currently zero client-side persistence).
  **Verify:** expand 2 folders, refresh → exactly those 2 remain open, the rest collapsed.

- [ ] **D3 — Expand-all / Collapse-all control** · _S_
  Control in the FileTree column header (next to `+ New`).
  **Verify:** "Collapse all" collapses every folder in one click; "Expand all" expands every folder in one click.

- [ ] **D4 — Remove fake status (`live`, `personal-vault`)** · _S_
  `web/src/components/TopBar.tsx` (both are hardcoded literals wired to nothing).
  **Verify:** neither `live` nor `personal-vault` appears in the header. (Making them real = B1, deferred.)

- [ ] **D5 — Breathing room around header buttons** · _S, cosmetic_
  `.colhead` / `.colhead-actions` in `web/src/app.css` + inline styles.
  **Verify:** Clear / + New / Edit touch neither the title nor the column edge; ≥12px gap around them. (Visual sign-off by user.)

- [ ] **D6 — Replace the wrench tool icon; add Vault/Secrets nav icons** · _S_
  Bespoke inline SVGs — the codebase hand-draws every icon to match the marketing site;
  no icon library, and adding one for ~3 glyphs is speculative weight. `ToolIcon` in
  `FileTree.tsx`, nav in `TopBar.tsx`.
  **Verify:** tool items under `tools/` show a non-wrench tool icon; the Vault and Secrets
  nav items each show a subtle inline-SVG icon consistent with the existing 16px / 1.5-stroke
  style; no new npm dependency is added.

### Broken / unusable flows

- [ ] **D7 — Test action can send params (real bug)** · _M_
  `web/src/components/ToolPanel.tsx` hardcodes `{}` to `POST /api/tools/:id/test`.
  **Verify:** an action using `${params.url}` + a filled value → real response; an action with no params → still works with an empty form; "unresolved template reference" no longer appears on valid input.

- [ ] **D8 — Connect capability audit + rewrite** · _M_
  `src/toolCatalog.ts` + prose in `web/src/views/Connect.tsx`.
  **Verify:** each of the 4 tool descriptions (`query` / `invoke` / `list_capabilities` / `remember`) matches current server behaviour; no description references the pre-execution-split model.

- [ ] **D9 — Aggregate git-status to folders + global counter** · _M_
  Badges are file-only today in `FileTree.tsx`.
  **Verify:** editing `tools/x/TOOL.md` → an indicator also appears on the `tools/` and `x/` folder rows; the Vault tab shows a pending count N; counter = 0 when clean.

- [ ] **D10 — Guided secret-add (happy path)** · _M–L_
  `web/src/views/Secrets.tsx` (currently free-text `<tool>__<connection>__<KEY>`).
  **Verify:** add a secret without typing `__` or knowing the convention — picker: choose tool → choose connection → key name → the app composes the ref; the resulting ref matches the format and links to the correct tool. (Global/tool-less secret = out of scope here.)

### Pending-action legibility (B2 — first real design-spec)

- [ ] **D11 — "Pending" indicator on the tool item in the file tree** · _M_
  A tool row shows a marker when something is pending for it: uncommitted changes to the
  tool's files, or (cli tools) not-yet-installed.
  **Verify:** create a tool via the agent (uncommitted) → the tool item shows a pending
  indicator; after commit (and install, if cli) → the indicator clears.
  _First slice of the broader approve/commit surface; the in-chat approve card and the
  commit-vs-install clarity follow in the B2 design-spec._

### Chat ingestion & file references

- [ ] **D12 — Chat attachments (drop + attachment icon) as run-context** · _L_
  On add (drag a file into the chat, or click an attachment icon): files are placed in a
  temp folder the agent can dig through for that run (not committed to the vault). Added
  files appear as chips above the input showing the attachments currently in the chat,
  plus a reference token inserted into the textarea so the user can write
  "This attachment: xxxxx and this attachment: yyyyy".
  **Verify:** drag two files into the chat → two chips above the input + two reference
  tokens in the textarea; send a message referencing them → the agent can read/inspect
  both files' contents during that run; the files are not committed into the vault.

- [ ] **D13 — `@`-file reference with autocomplete from the tree** · _M_
  Typing `@` opens an autocomplete of vault files (sourced from the tree); selecting one
  inserts a reference to the file's path so the agent knows the path to open/inspect.
  **Verify:** type `@` in the chat → a suggestion list of vault files; pick one → a
  path-reference is inserted; on send, the agent knows the path and can read that file.

- [ ] **D14 — Drag file/folder from the tree into the chat = reference** · _M, via `/frontend-design`_
  Same reference mechanism as D13 (inserts a path reference). Interaction & visuals worked
  out via `/frontend-design`.
  **Verify:** drag a file from the tree onto the chat input → a path-reference appears (as
  with `@`) and the agent knows the path; a folder → a reference to the folder path.

### Visual redesign

- [ ] **D15 — Redesign `ToolPanel` (away from JSON dumps / inline styles)** · _M, via `/frontend-design`_
  `web/src/components/ToolPanel.tsx` currently renders `JSON.stringify(..., null, 2)` in
  `<pre>` blocks with heavy inline styles.
  **Verify:** the tool preview shows structured fields (installed / permissions / actions /
  connections) without raw JSON dumps; matches the `/frontend-design` mini-spec; not the
  current green-box style.

---

## B. Deferred to their own spec (not yet verifiable)

- **B7 — Agent "insane" at vault curation (the proposition).** Needs (1) the in-flight
  overlay work (S1932/S1933: `AGENTS.md` conventions are not yet in the prompt composition,
  so the user's conventions don't actually steer the agent), and (2) an _evaluation_
  definition: what "correctly placed / wiki-effect preserved" means, measurably. Not
  checkable until an eval exists.

- **B8 — Caller smoothness.** Needs a protocol decision: shorten the mandatory
  `query → invoke` round-trip (a fast-path invoke without an LLM run?), expose a per-action
  param schema to the caller, and reuse MCP connections. Each becomes checkable once the
  shape is chosen.

---

## Suggested order

1. **Parallel:** D1 → D2 → D3 → D4 → D5 → D6 (polish sweep).
2. **B2 design-spec, starting with D11**, then the broader approve/commit surface.
3. Broken flows: D7 (bug) → D8 (audit) → D9 (aggregated badges).
4. Chat references & ingestion: D13 (reference model) → D12 (attachments) → D14 (drag).
5. D15 (`ToolPanel` redesign) via `/frontend-design` — independent, can slot in early.
6. D10 (guided secret-add).
7. Later, separately: B7, then B8.

# ToolPanel polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the ToolPanel's install-confirm + error states legible in the viewer column: permissions readable, errors in a contained scrollable block, load-error shows the real server message.

**Architecture:** One component (`ToolPanel.tsx`) + one CSS class (`.tp-error`). Atomic — layout, error block, and load-error message flip together.

**Tech Stack:** React + Vite + TS, vitest + @testing-library/react (client tests from `web/`).

**Spec:** `docs/superpowers/specs/2026-07-01-toolpanel-polish-design.md`

**Conventions:** terse style; husky gate = eslint + JSDoc-on-exports + `tsc`. Client tests from `web/` → `npx vitest run`.

---

### Task 1: ToolPanel legibility (atomic)

**Files:** Modify `web/src/components/ToolPanel.tsx`, `web/src/app.css`, `web/src/components/ToolPanel.test.tsx`.

- [ ] **Step 1: Write failing tests**

Read the existing `ToolPanel.test.tsx` first (it has the 2A render/install/Test/stale-race tests + a `TOOL` fixture + a `deferred` helper). Add:
```ts
it("shows the real server error when the tool fails to load", async () => {
  (api.tool as any).mockRejectedValue(new Error('tool cb: action "fetch" — command must be a non-empty array of argv tokens'));
  render(<ToolPanel id="cb" />);
  expect(await screen.findByText(/must be a non-empty array of argv tokens/)).toBeTruthy();
  expect(screen.queryByText(/save the manifest first/)).toBeNull();
});

it("shows an install error in a contained error block", async () => {
  (api.tool as any).mockResolvedValue(TOOL); // TOOL: not installed, cli
  (api.installTool as any).mockRejectedValue(new Error("docker build failed:\nline1\nline2 exit code: 127"));
  const { container } = render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Install & trust"));
  fireEvent.click(screen.getByText("Confirm install"));
  expect(await screen.findByText(/docker build failed/)).toBeTruthy();
  expect(container.querySelector(".tp-error")).toBeTruthy();
});

it("keeps the requested permissions legible in the confirm card", async () => {
  (api.tool as any).mockResolvedValue({ ...TOOL, permissions: { network: "any" } });
  render(<ToolPanel id="cb" />);
  fireEvent.click(await screen.findByText("Install & trust"));
  const card = screen.getByText("Permissions requested").closest("div")!;
  expect(card.textContent).toContain("network");
  expect(card.textContent).toContain("any");
});
```
(Adapt to the file's real fixture/imports. If `TOOL` is `installed:false, type:"cli"` already, reuse it; otherwise spread overrides.)

- [ ] **Step 2: Run — fail.** From `web/`: `npx vitest run src/components/ToolPanel.test.tsx` → the new tests FAIL (loadError boolean hides the message; no `.tp-error`).

- [ ] **Step 3: Implement in `ToolPanel.tsx`** (per the spec):
  - `loadError` state `useState("")`; capture `e.message` in the mount-effect `.catch` (keep the `live` guard) and in `load()`'s `.catch`; clear to `""` on success.
  - Replace the `if (loadError)` early return with the panel-container block showing "Couldn't load this tool" + `<pre className="tp-error">{loadError}</pre>` + the fix hint.
  - Loading state: wrap in `<div className="toolpanel" …>Loading…</div>`.
  - Confirm card: add `display: "block"` to its inline style.
  - Install error (`installError`): render as `<pre className="tp-error">{installError}</pre>`.
  - Uninstall error: same `.tp-error` block instead of the inline `<span>`.
  - Test-result `<pre>`: add `maxHeight: 280` to its inline style.

- [ ] **Step 4: Add `.tp-error` to `web/src/app.css`** (verbatim from the spec).

- [ ] **Step 5: Run — pass.** From `web/`: `npx vitest run src/components/ToolPanel.test.tsx` → all green (new + existing 2A tests).

- [ ] **Step 6: Full suite + gate.** From `web/`: `npx vitest run && npx tsc --noEmit`. From root: `npx eslint web/src`. Expected: green; 0 eslint errors.

- [ ] **Step 7: Commit**
```bash
git add web/src/components/ToolPanel.tsx web/src/app.css web/src/components/ToolPanel.test.tsx
git commit -m "feat: legible ToolPanel install-confirm + error states in the viewer column"
```

---

## Final verification
- From `web/`: `npx vitest run` green; `npx tsc --noEmit` clean.
- From root: `npx eslint web/src` clean.
- Manual (after rebuild): the install-confirm card is a vertical stack with `network: any` fully readable; a failed install shows the docker error in a contained scrollable red block; an invalid manifest shows the real validation message.

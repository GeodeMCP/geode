# Clickable In-Vault Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an in-vault link in a rendered note opens that file in the viewer; external links open in a new tab.

**Architecture:** A pure `resolveLink(fromFile, href)` helper classifies a Markdown link (internal/external/ignore). `Viewer.tsx` delegates clicks on the Formatted view through it — internal → `onOpenFile(path)` (wired to `VaultHome.select`), external → new tab. No URL routing.

**Tech Stack:** React 18 + Vite + TypeScript (strict), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-26-clickable-vault-links-design.md`

**Conventions:** Pre-commit gate requires a JSDoc `/** … */` on every top-level declaration (no `--no-verify`). Web tests/build from `web/`: `cd web && npx vitest run <file>`, `npm run typecheck`. (No `npm run lint` in `web/`; manual: `npx eslint <file>`.)

---

## Task 1: `links.ts` resolver (TDD)

**Files:**
- Create: `web/src/links.ts`
- Test: `web/src/links.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/links.test.ts
import { describe, it, expect } from "vitest";
import { resolveLink } from "./links";

describe("resolveLink", () => {
  it("resolves relative in-vault paths against the source file's folder", () => {
    expect(resolveLink("notes/a.md", "../experiments/b.md")).toEqual({ kind: "internal", path: "experiments/b.md" });
    expect(resolveLink("index.md", "experiments/index.md")).toEqual({ kind: "internal", path: "experiments/index.md" });
    expect(resolveLink("notes/a.md", "./c.md")).toEqual({ kind: "internal", path: "notes/c.md" });
  });
  it("clamps .. at the vault root", () => {
    expect(resolveLink("a.md", "../../x.md")).toEqual({ kind: "internal", path: "x.md" });
  });
  it("treats a leading slash as vault-root-absolute", () => {
    expect(resolveLink("notes/a.md", "/experiments/b.md")).toEqual({ kind: "internal", path: "experiments/b.md" });
  });
  it("strips a query/hash suffix", () => {
    expect(resolveLink("notes/a.md", "../experiments/b.md#sec")).toEqual({ kind: "internal", path: "experiments/b.md" });
  });
  it("classifies external links", () => {
    expect(resolveLink("a.md", "https://example.com")).toEqual({ kind: "external" });
    expect(resolveLink("a.md", "mailto:x@y.com")).toEqual({ kind: "external" });
    expect(resolveLink("a.md", "//cdn.com/x")).toEqual({ kind: "external" });
  });
  it("ignores empty and in-page anchors", () => {
    expect(resolveLink("a.md", "#heading")).toEqual({ kind: "ignore" });
    expect(resolveLink("a.md", "")).toEqual({ kind: "ignore" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/links.test.ts`
Expected: FAIL — `Failed to resolve import "./links"`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/links.ts

/** A classified Markdown link: an in-vault file (resolved path), an external URL, or ignorable. */
export type Link =
  | { kind: "internal"; path: string }
  | { kind: "external" }
  | { kind: "ignore" };

/** Classifies a Markdown link `href` relative to the file it appears in. Relative paths resolve against the source file's folder, normalising `.`/`..` (clamped at the vault root); a leading `/` is vault-root-absolute; `?`/`#` suffixes are stripped. Empty or in-page-anchor hrefs are ignorable; scheme/protocol-relative hrefs are external. */
export function resolveLink(fromFile: string, href: string): Link {
  const h = href.trim();
  if (!h || h.startsWith("#")) return { kind: "ignore" };
  if (h.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(h)) return { kind: "external" };
  const clean = h.replace(/[?#].*$/, "");
  if (!clean) return { kind: "ignore" };
  const baseDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const segs = clean.startsWith("/") ? [] : baseDir ? baseDir.split("/") : [];
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (segs.length) segs.pop(); continue; }
    segs.push(seg);
  }
  const path = segs.join("/");
  return path ? { kind: "internal", path } : { kind: "ignore" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/links.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/robbertvermeulen/Projects/geodemcp-2
git add web/src/links.ts web/src/links.test.ts
git commit -m "feat(web): add resolveLink helper for in-vault link classification"
```

---

## Task 2: Wire link-clicks into the Viewer (TDD)

**Files:**
- Modify: `web/src/components/Viewer.tsx`
- Modify: `web/src/views/VaultHome.tsx`
- Test: `web/src/components/Viewer.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests (append to the existing `describe("Viewer", …)` block)**

```tsx
  it("opens an internal link target on click", () => {
    const onOpenFile = vi.fn();
    const { container } = render(
      <Viewer {...base} path="notes/a.md" content={"[x](../experiments/b.md)"} onOpenFile={onOpenFile} />,
    );
    const a = container.querySelector(".doc.md a");
    expect(a).toBeTruthy();
    fireEvent.click(a!);
    expect(onOpenFile).toHaveBeenCalledWith("experiments/b.md");
  });

  it("does not navigate internally for external links", () => {
    const onOpenFile = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Viewer {...base} path="notes/a.md" content={"[x](https://example.com)"} onOpenFile={onOpenFile} />,
    );
    fireEvent.click(container.querySelector(".doc.md a")!);
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
```

Add `vi` to the vitest import at the top of the file if it's not already imported (it imports `describe, it, expect, afterEach`; add `vi`).

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/components/Viewer.test.tsx`
Expected: FAIL — `onOpenFile` is not a prop yet; clicks aren't intercepted.

- [ ] **Step 3: Update `Viewer.tsx`**

(a) Add the import (next to the `fileType` import):
```tsx
import { resolveLink } from "../links";
```

(b) Add `onOpenFile` to the props type and destructure. Change the props signature to include it:
```tsx
export function Viewer({ path, content, diff, dirty, compose, onCommit, onDiscard, onSave, onOpenFile }: {
  path: string | null; content: string; diff: string; dirty: boolean;
  compose: { path: string; draft: string } | null;
  onCommit: () => void; onDiscard: () => void; onSave: (text: string) => void;
  onOpenFile?: (path: string) => void;
}) {
```

(c) Add the click handler inside the component (e.g. just after `const save = …`):
```tsx
  const onLinkClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    const link = resolveLink(path ?? "", href);
    if (link.kind === "internal") { e.preventDefault(); onOpenFile?.(link.path); }
    else if (link.kind === "external") { e.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
  };
```

(d) Attach it to the Formatted Markdown container — change:
```tsx
        <div className="doc md">
```
to:
```tsx
        <div className="doc md" onClick={onLinkClick}>
```

(`React.MouseEvent` is already used elsewhere in the codebase, e.g. `FileTree.tsx`, so the type resolves without an extra import.)

- [ ] **Step 4: Wire `VaultHome.tsx`**

Change the `<Viewer ... />` line to pass `onOpenFile`:
```tsx
      <Viewer path={selected} content={content} diff={diff} dirty={selectedDirty} compose={compose} onCommit={commit} onDiscard={discard} onSave={save} onOpenFile={select} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/Viewer.test.tsx` (now 7 tests, all pass)
Then: `cd web && npx vitest run` (full suite green) and `cd web && npm run typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
cd /Users/robbertvermeulen/Projects/geodemcp-2
git add web/src/components/Viewer.tsx web/src/views/VaultHome.tsx web/src/components/Viewer.test.tsx
git commit -m "feat(web): open in-vault links on click; external links to a new tab"
```

---

## Task 3: Build, lint, live validation

**Files:** none (verification)

- [ ] **Step 1: Build + lint + full suite**

```bash
cd /Users/robbertvermeulen/Projects/geodemcp-2/web && npm run build && npm run typecheck && npx vitest run
cd /Users/robbertvermeulen/Projects/geodemcp-2 && npm run lint
```
Expected: build succeeds; typecheck clean; all tests pass; lint 0 errors.

- [ ] **Step 2: Live validation** (the kernel serves `web/dist` from disk, so the rebuild is live)

Open http://localhost:8787/, log in, open `notes/pricing-standup.md` (Formatted view), click the `pricing-variant-test` link → the viewer switches to `experiments/pricing-variant-test.md`. Add/inspect an external link in a note → clicking it opens a new tab and the dashboard stays put.

---

## Self-Review (completed by plan author)

- **Spec coverage:** `resolveLink` helper (Task 1) ✓; click handler internal/external/ignore (Task 2c) ✓; `onOpenFile` wired to `select` (Task 2d, Step 4) ✓; only the Formatted view intercepts (handler on `.doc.md` only) ✓; tests for helper + viewer (Tasks 1, 2) ✓; build/lint/live (Task 3) ✓.
- **Placeholders:** none — complete code + commands throughout.
- **Type consistency:** `Link` union from Task 1 consumed in Task 2; `onOpenFile?: (path: string) => void` matches `VaultHome.select(p: string)`.

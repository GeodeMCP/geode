# Clickable In-Vault Links — Design

**Status:** approved (conversation, 2026-06-26)
**Date:** 2026-06-26
**Area:** dashboard SPA (`web/src/`), file viewer

## Problem

In the dashboard's File editor, a rendered Markdown note links to other vault files with relative hrefs (e.g. `[pricing-variant-test](../experiments/pricing-variant-test.md)`). Today the note is mounted via `dangerouslySetInnerHTML` with **no click handling**, and the SPA has **no URL routing** for files, so clicking such a link triggers a default browser navigation to a relative URL (`/experiments/…`) that just hits the SPA fallback — the dashboard never switches to the target file.

## Goal

Clicking an in-vault link in a rendered note opens that file in the viewer. External links open in a new tab instead of replacing the SPA.

## Scope

In scope:
- A pure link-classification/resolution helper.
- A delegated click handler on the **Formatted** Markdown view in `Viewer.tsx` that opens internal targets and routes external links to a new tab.
- Wiring the viewer's "open file" callback to the existing `select` in `VaultHome`.

Explicitly **out of scope** (decided "click-to-open only"):
- **URL deep-linking / addressable files** (hash routes, shareable links, browser back/forward, refresh-stays-on-file). Not needed to make link-clicks work; can be a separate later feature.
- **Links inside chat answers** (`Chat.tsx` also renders Markdown). The same helper is a ~1-line add there later if wanted.
- The Source/Edit (CodeMirror) views — they render code, not anchors, so there's nothing to intercept.

## Decisions

1. **No URL routing.** Click interception + relative-path resolution → call the existing `select(path)`. Files stay in component state.
2. **External links open in a new tab** (`window.open(href, "_blank", "noopener,noreferrer")`) so the SPA isn't navigated away. In-page `#anchors` and empty hrefs are left to default behavior.
3. **Relative resolution against the current file's folder**, normalizing `.`/`..`, with `..` **clamped at the vault root** (can't escape). Leading-`/` hrefs are treated as vault-root-absolute. Any `?`/`#` suffix on the href is stripped before resolution.
4. **Non-existent target** → simply selected; the viewer shows empty content (existing behavior for an unknown path). No toast. The server's `safeResolve` still guards every `api.file` fetch, so a malformed path can't read outside the vault.

## Components

### `web/src/links.ts` (new, pure)

```ts
export type Link =
  | { kind: "internal"; path: string }
  | { kind: "external" }
  | { kind: "ignore" };

/** Classifies a Markdown link href relative to the file it appears in: an in-vault file (resolved path), an external URL, or ignorable (empty / in-page anchor). */
export function resolveLink(fromFile: string, href: string): Link;
```

Rules: empty or `#…` → `ignore`; `//…` or a URI scheme (`/^[a-zA-Z][a-zA-Z0-9+.-]*:/`) → `external`; otherwise strip `?`/`#`, resolve relative to `dirname(fromFile)` (or root if the href is leading-`/`), normalize `.`/`..` (clamp `..` at root), join with `/` → `internal { path }` (or `ignore` if it resolves to empty).

### `web/src/components/Viewer.tsx`

- New optional prop `onOpenFile?: (path: string) => void`.
- A delegated `onClick` on the `.doc.md` container: find the nearest `<a>` (`(e.target as HTMLElement).closest("a")`), read its raw `getAttribute("href")`, call `resolveLink(path ?? "", href)`:
  - `internal` → `e.preventDefault()` + `onOpenFile?.(link.path)`
  - `external` → `e.preventDefault()` + `window.open(href, "_blank", "noopener,noreferrer")`
  - `ignore` → do nothing (default)

### `web/src/views/VaultHome.tsx`

- Pass `onOpenFile={select}` to `<Viewer>` (`select` already clears `compose` and sets `selected`).

## Testing

- `web/src/links.test.ts`:
  - internal: `("notes/a.md", "../experiments/b.md")` → `experiments/b.md`; `("index.md", "experiments/index.md")` → `experiments/index.md`; `("notes/a.md", "./c.md")` → `notes/c.md`; `("a.md", "../../x.md")` → `x.md` (clamped); `("notes/a.md", "/experiments/b.md")` → `experiments/b.md` (root-absolute); `("notes/a.md", "../experiments/b.md#sec")` → `experiments/b.md` (suffix stripped).
  - external: `https://example.com`, `mailto:x@y.com`, `//cdn.com/x` → `external`.
  - ignore: `#heading`, `""` → `ignore`.
- `web/src/components/Viewer.test.tsx` (extend): clicking an internal link in a `.md` note calls `onOpenFile` with the resolved path; clicking an external link does **not** call `onOpenFile` (mock `window.open` to avoid the jsdom "Not implemented" notice).

## Live validation

Build + refresh the dashboard; open `notes/pricing-standup.md` (Formatted), click the `pricing-variant-test` link → the viewer switches to `experiments/pricing-variant-test.md`. Click an external link in a note → opens a new tab, dashboard stays put.

# Dashboard 2C-1 — Connect pill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Connect moves from a left-nav tab to a top-right pill button; the Connect page is unchanged.

**Architecture:** One file of logic (`TopBar.tsx`) + one CSS rule + a new TopBar test. `View`/App routing untouched.

**Tech Stack:** React + Vite + TypeScript, vitest + @testing-library/react (client tests from `web/`).

**Spec:** `docs/superpowers/specs/2026-07-01-connect-pill-design.md`

**Conventions:** terse existing style; husky gate runs eslint + JSDoc-on-exports + `tsc`. Client tests from `web/` → `npx vitest run`.

---

### Task 1: Connect pill in TopBar (atomic)

**Files:** Modify `web/src/components/TopBar.tsx`, `web/src/app.css`; Create `web/src/components/TopBar.test.tsx`.

- [ ] **Step 1: Write `TopBar.test.tsx` (TDD)**

Match the client harness (`vi`, `render`, `screen`, `fireEvent`, `afterEach(cleanup)`). `TopBar` props: `{ view, onNav, hasTools, onLogout }`.
```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, vi, it, expect } from "vitest";
import { TopBar } from "./TopBar";
afterEach(cleanup);

it("renders Connect as a top-right pill, not a left-nav tab", () => {
  const onNav = vi.fn();
  const { container } = render(<TopBar view="Vault" onNav={onNav} hasTools={false} onLogout={() => {}} />);
  // Connect is NOT inside the left <nav>
  const nav = container.querySelector("nav")!;
  expect(nav.textContent).not.toContain("Connect");
  expect(nav.textContent).toContain("Vault");
  // Connect pill exists and navigates
  const pill = screen.getByRole("button", { name: /connect/i });
  expect(pill.className).toContain("pill");
  fireEvent.click(pill);
  expect(onNav).toHaveBeenCalledWith("Connect");
});

it("marks the pill active only on the Connect view", () => {
  const { rerender } = render(<TopBar view="Vault" onNav={() => {}} hasTools={false} onLogout={() => {}} />);
  expect(screen.getByRole("button", { name: /connect/i }).className).not.toContain("active");
  rerender(<TopBar view="Connect" onNav={() => {}} hasTools={false} onLogout={() => {}} />);
  expect(screen.getByRole("button", { name: /connect/i }).className).toContain("active");
});

it("still shows Secrets in the left nav when hasTools", () => {
  const { container } = render(<TopBar view="Vault" onNav={() => {}} hasTools={true} onLogout={() => {}} />);
  expect(container.querySelector("nav")!.textContent).toContain("Secrets");
});
```

- [ ] **Step 2: Run — fail.** From `web/`: `npx vitest run src/components/TopBar.test.tsx` → FAIL (Connect still in nav; no pill).

- [ ] **Step 3: Implement in `TopBar.tsx`**
- Change the `items` filter to exclude Connect:
  ```ts
  const items = VIEWS.filter((v) => (hasTools || ALWAYS.has(v)) && v !== "Connect");
  ```
- Add a `ConnectIcon` (16×16 stroke style, a link/plug glyph), e.g.:
  ```tsx
  const ConnectIcon = () => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 9.5 9.5 6.5M7 4.5l.8-.8a2.4 2.4 0 0 1 3.4 3.4l-.8.8M9 11.5l-.8.8a2.4 2.4 0 0 1-3.4-3.4l.8-.8" />
    </svg>
  );
  ```
- In `.tb-right`, add the pill before the `live` chip:
  ```tsx
  <button className={`pill${view === "Connect" ? " active" : ""}`} onClick={() => onNav("Connect")} title="Connect a client"><ConnectIcon /> Connect</button>
  ```

- [ ] **Step 4: CSS** — add the `.pill` rules from the spec to `web/src/app.css` (near the TOPBAR section).

- [ ] **Step 5: Run — pass.** From `web/`: `npx vitest run src/components/TopBar.test.tsx` → PASS.

- [ ] **Step 6: Full suite + gate.** From `web/`: `npx vitest run && npx tsc --noEmit`. From root: `npx eslint web/src`. Expected: all green; 0 eslint errors.

- [ ] **Step 7: Commit**
```bash
git add web/src/components/TopBar.tsx web/src/components/TopBar.test.tsx web/src/app.css
git commit -m "feat(2C-1): Connect as a top-right pill instead of a nav tab"
```

---

## Final verification
- From `web/`: `npx vitest run` green; `npx tsc --noEmit` clean.
- From root: `npx eslint web/src` clean.
- Connect page (`views/Connect.tsx`) and App routing untouched (`git diff --stat` shows only TopBar.tsx, TopBar.test.tsx, app.css).

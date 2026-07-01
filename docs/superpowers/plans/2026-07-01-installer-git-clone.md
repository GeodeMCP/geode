# Installer git-clone fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `buildDockerfile` clones repo sources in a throwaway `alpine/git` stage and `COPY`s into the base, so slim bases (no `git`) can install.

**Architecture:** One pure function (`buildDockerfile` in `src/docker.ts`) + unit tests. No runtime/integration change.

**Tech Stack:** TypeScript ESM, vitest. Server tests from repo root: `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-07-01-installer-git-clone-design.md`

**Conventions:** terse style; husky gate = eslint + JSDoc-on-exports + `tsc`. `buildDockerfile`'s existing JSDoc stays valid.

---

### Task 1: Multi-stage clone in buildDockerfile (atomic)

**Files:** Modify `src/docker.ts` (`buildDockerfile`), `test/docker.test.ts`.

- [ ] **Step 1: Write failing tests**

In `test/docker.test.ts`, add (the file already has `M` = repo-source manifest with base `node:20-slim`, ref `v1`, install `["npm ci","npm run build"]`):
```ts
test("buildDockerfile clones in a git stage so the base needs no git", () => {
  const df = buildDockerfile(M);
  expect(df).toContain("FROM alpine/git AS clone");
  expect(df).toContain("COPY --from=clone /src /tool");
  // git clone runs in the clone stage, BEFORE the base image
  expect(df.indexOf("git clone")).toBeGreaterThan(-1);
  expect(df.indexOf("git clone")).toBeLessThan(df.indexOf("FROM node:20-slim"));
  // the base stage never runs git
  expect(df.slice(df.indexOf("FROM node:20-slim"))).not.toContain("git clone");
});

test("buildDockerfile package source needs no git stage", () => {
  const df = buildDockerfile({ ...M, source: { package: "pip:cloakbrowser" }, image: { base: "python:3.12-slim" } });
  expect(df).toContain("FROM python:3.12-slim");
  expect(df).toContain("RUN pip install cloakbrowser");
  expect(df).not.toContain("alpine/git");
  expect(df).not.toContain("git clone");
});
```

- [ ] **Step 2: Run — fail.** `npx vitest run test/docker.test.ts` → the two new tests FAIL (single-stage still).

- [ ] **Step 3: Implement** — replace `buildDockerfile` in `src/docker.ts` with the multi-stage version from the spec (repo source → `FROM alpine/git AS clone` + clone + `FROM <base>` + `COPY --from=clone /src /tool`; else `FROM <base>` + optional package install; then the `install` RUNs). Keep the JSDoc.

- [ ] **Step 4: Run — pass.** `npx vitest run test/docker.test.ts` → all green, including the pre-existing `buildDockerfile clones the pinned ref …` test (its substrings are still present).

- [ ] **Step 5: Full suite + gate.** `npx vitest run` (server) green; `npx tsc --noEmit` clean; `npx eslint src test` clean (0 errors).

- [ ] **Step 6: Commit**
```bash
git add src/docker.ts test/docker.test.ts
git commit -m "fix(#3): clone repo sources in an alpine/git stage so slim bases can install"
```

---

## Final verification
- `npx vitest run` green; `npx tsc --noEmit` clean; `npx eslint src test` clean.
- The generated Dockerfile for a repo tool is multi-stage: `alpine/git` clone → `COPY --from=clone` into the base; the base image never runs `git`.

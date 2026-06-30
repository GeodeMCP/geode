# Agent tool-onboarding (#2b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the owner `query` the vault agent to onboard a repo — the agent reads it and writes a conforming `tools/<id>/TOOL.md`; the owner then installs it via the existing #3 flow.

**Architecture:** A generic skill resolver (kernel-default ⊕ vault-override, per filename) ships the **install-SOP** in the kernel (`kernel-skills/onboard-tool.md`). `query()` appends a one-line footer pointing the agent at the resolved SOP path; the constitution gains onboarding-awareness + the hard rules. The agent (Agent SDK bash) clones the repo to a temp dir, inspects, and authors the manifest — it never installs or runs code (that's owner-gated #3).

**Tech Stack:** TypeScript ESM, vitest, the existing `query.ts`/`engine.ts`/`tools.ts`/`#3` installer.

**Spec:** `docs/superpowers/specs/2026-06-30-agent-tool-onboarding-design.md`

**Branch:** `feat/agent-onboarding`. Husky gate requires JSDoc on exports. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File map

| File | Change |
|---|---|
| `src/skills.ts` | **new** — `kernelSkillsDir()`, `resolveSkill(vaultRoot, name)`, `buildSkillsFooter(vaultRoot)` |
| `kernel-skills/onboard-tool.md` | **new** — the install-SOP (declarative onboarding guidance + worked `cli` example) |
| `src/constitution.ts` | add onboarding-awareness + the hard rules |
| `src/query.ts` | append `buildSkillsFooter(deps.workspace.root)` to the system prompt |
| `test/skills.test.ts` | **new** — resolver + footer unit tests |
| `test/query.test.ts` | assert the system prompt the engine receives contains the resolved SOP path |
| `test/e2e.manual.md` | add a manual "onboard a repo via the agent" check |

---

## Task 1: the skill resolver

**Files:** Create `src/skills.ts`, `test/skills.test.ts`.

- [ ] **Step 1: failing test** — `test/skills.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { kernelSkillsDir, resolveSkill, buildSkillsFooter } from "../src/skills.js";

test("kernelSkillsDir points at the shipped kernel-skills dir containing onboard-tool.md", () => {
  const dir = kernelSkillsDir();
  expect(dir.endsWith("kernel-skills")).toBe(true);
});

test("resolveSkill returns the kernel default when no vault override exists", () => {
  const root = mkdtempSync(join(tmpdir(), "ge-vault-"));
  expect(resolveSkill(root, "onboard-tool.md")).toBe(join(kernelSkillsDir(), "onboard-tool.md"));
});

test("resolveSkill returns the vault override when present (vault wins)", () => {
  const root = mkdtempSync(join(tmpdir(), "ge-vault-"));
  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(join(root, "skills", "onboard-tool.md"), "mine");
  expect(resolveSkill(root, "onboard-tool.md")).toBe(join(root, "skills", "onboard-tool.md"));
});

test("buildSkillsFooter names the resolved onboarding-skill path", () => {
  const root = mkdtempSync(join(tmpdir(), "ge-vault-"));
  const footer = buildSkillsFooter(root);
  expect(footer).toContain(resolveSkill(root, "onboard-tool.md"));
  expect(footer.toLowerCase()).toContain("onboard");
});
```

- [ ] **Step 2: run → FAIL** (`npx vitest run test/skills.test.ts`).

- [ ] **Step 3: implement `src/skills.ts`:**
```ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the kernel-shipped skills directory (sits at the repo root, like web/dist). */
export function kernelSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "kernel-skills");
}

/** Resolves a skill file by name: the vault's `skills/<name>` override if it exists, else the kernel default. */
export function resolveSkill(vaultRoot: string, name: string): string {
  const override = join(vaultRoot, "skills", name);
  return existsSync(override) ? override : join(kernelSkillsDir(), name);
}

/** A short system-prompt footer telling the agent where its onboarding skill lives (loaded on demand). */
export function buildSkillsFooter(vaultRoot: string): string {
  return `\n\nYour onboarding skill: when the user asks you to onboard/install a tool, repo, API or MCP, read \`${resolveSkill(vaultRoot, "onboard-tool.md")}\` and follow it.`;
}
```

- [ ] **Step 4: run → PASS**; **Step 5: commit**
```bash
git add src/skills.ts test/skills.test.ts
git commit -m "feat(skills): kernel-default + vault-override skill resolver + system-prompt footer"
```

---

## Task 2: the install-SOP

**Files:** Create `kernel-skills/onboard-tool.md`; add a test to `test/skills.test.ts`.

- [ ] **Step 1: add a failing test** — append to `test/skills.test.ts`:
```ts
import { readFileSync } from "node:fs";
test("the shipped onboard-tool SOP exists and is substantive", () => {
  const body = readFileSync(join(kernelSkillsDir(), "onboard-tool.md"), "utf8");
  expect(body.length).toBeGreaterThan(400);
  expect(body).toContain("TOOL.md");
  expect(body.toLowerCase()).toContain("never install");
});
```

- [ ] **Step 2: run → FAIL** (file missing).

- [ ] **Step 3: create `kernel-skills/onboard-tool.md`:**
```markdown
---
name: onboard-tool
description: Turn a repo/CLI, HTTP API, or MCP server into a Geode tool the owner can install + invoke.
---

# Onboarding a tool

You turn something the user wants to use — a git repo / CLI, an HTTP API, or an MCP server — into a conforming `tools/<id>/TOOL.md` in the vault. **You only WRITE the manifest. You never install it and never run the tool's code** — the owner approves "Install & trust" and the kernel runs it sandboxed in Docker.

## Classify
- a git repo / installable binary → `type: cli`
- an HTTP API (REST/GraphQL) → `type: http`
- an external MCP server → `type: mcp`

## Derive by inspection (don't ask the user)
Clone the repo into a temp dir (`mktemp -d`, never into the vault) and read its `README`, `package.json`/`pyproject.toml`, and `Dockerfile`; or read the API's OpenAPI/docs. From that, fill in:
- `source`: `{ repo: "<url>", ref: "<a pinned tag or commit>" }` (always pin).
- `install`: the build/setup commands (e.g. `["npm ci", "npm run build"]`).
- `bin`: the entrypoint to run.
- `image`: `{ base: "node:20-slim" }` (or `python:3.12-slim`, etc. — match the project).
- `actions`: the operations to expose; each a `command` template + `params`.
- `connections` + `requires`: if it needs auth, declare a connection label and the secret **key names** — NEVER values.
- `permissions`: the MINIMAL access it needs — `network: none` if it works offline, else the specific hosts (e.g. `["api.x.com"]`); `any` only if unavoidable, and say so. The owner reviews these.

## Hard rules
- Never write a secret value into the manifest — only labels + `requires` key names.
- Never run the install or the tool yourself; you only write `tools/<id>/TOOL.md`.
- Pin `source.ref`. Reference by canonical id; the manifest is the single source of truth.
- If something is ambiguous (which actions, which base image), pick the most reasonable option and state the assumption in your report.
- Clean up the temp clone when done.

## Output + handoff
Write `tools/<id>/TOOL.md`, then report concisely: what type, the actions, the requested permissions, any secret(s) the owner must set, and:
> "Review it and click **Install & trust** in the dashboard to build + run it."

## Worked example (a `cli` repo tool)
```yaml
---
id: cloakbrowser
name: CloakBrowser
type: cli
description: Fetch pages that block normal scrapers (bot-resistant headless browser).
image: { base: "node:20-slim" }
source: { repo: "https://github.com/CloakHQ/cloakbrowser", ref: "v1.0.0" }
install: ["npm ci", "npm run build"]
bin: "node dist/cli.js"
permissions: { network: any }
connections: [{ label: default }]
actions:
  fetch:
    description: Fetch a URL, returning the page HTML.
    params: [{ name: url, required: true }]
    command: "fetch --url ${params.url}"
---
Use `invoke(cloakbrowser, fetch, { url })`. Owner installs via "Install & trust".
```
```

- [ ] **Step 4: run → PASS**; **Step 5: commit**
```bash
git add kernel-skills/onboard-tool.md test/skills.test.ts
git commit -m "feat(skills): ship the install-SOP (onboard-tool) declarative onboarding guidance"
```

---

## Task 3: constitution awareness + query() footer injection

**Files:** Modify `src/constitution.ts`, `src/query.ts`, `test/query.test.ts`.

- [ ] **Step 1: constitution** — in `src/constitution.ts`, add this bullet to the "Discipline (always)" list (after the integrations/tools bullet about reading `tools/<id>/TOOL.md`):
```
- You can ONBOARD tools/connections/MCPs for the user: when asked, follow your onboarding skill (its path is given below). You AUTHOR the tools/<id>/TOOL.md but NEVER install it or run the tool's code — the owner approves that. Inspect repos in a temp dir, never in the vault; never write secret values into a manifest.
```

- [ ] **Step 2: query() injection (update the test first)** — in `test/query.test.ts`, find the test that runs `query` with a stub engine that captures its options (the engine is injectable; the existing tests pass a fake engine). Add an assertion that the `systemPrompt` the engine received contains the resolved onboarding-skill path. If the existing fake engine doesn't capture `systemPrompt`, capture it: e.g.
```ts
let seenPrompt = "";
const engine = async function* (opts: any) { seenPrompt = opts.systemPrompt; yield { type: "result", text: "ok" }; };
// ... run query(deps with this engine, "hi") ...
expect(seenPrompt).toContain("onboard-tool.md");
```
(Read the current `test/query.test.ts` and adapt to its existing structure/helpers.)
Run `npx vitest run test/query.test.ts` → expect FAIL (footer not yet appended).

- [ ] **Step 3: implement** — in `src/query.ts`, add `import { buildSkillsFooter } from "./skills.js";` and change the engine call's `systemPrompt: deps.systemPrompt,` (line ~71) to:
```ts
        systemPrompt: deps.systemPrompt + buildSkillsFooter(deps.workspace.root),
```

- [ ] **Step 4: run → PASS** (`npx vitest run test/query.test.ts`).

- [ ] **Step 5: full suite + commit** — `npm test` all green; `npm run typecheck` clean.
```bash
git add src/constitution.ts src/query.ts test/query.test.ts
git commit -m "feat(agent): onboarding-aware constitution + inject the resolved onboarding-skill path"
```

---

## Task 4: manual e2e + sanity

**Files:** Modify `test/e2e.manual.md`.

- [ ] **Step 1: document the manual check** — add a section to `test/e2e.manual.md`:
```markdown
## Onboard a tool via the agent (#2b-1)

1. With the kernel running and an owner signed in, `query` the agent (dashboard chat or an MCP client):
   `{ "instruction": "Onboard the repo at https://github.com/<a small CLI repo> as a tool." }`
2. Expect: the agent clones the repo to a temp dir, inspects it, and writes `tools/<id>/TOOL.md` (a `cli` manifest with source/ref/install/bin/actions and a proposed `permissions`). It reports the proposed permissions + "review + Install & trust" and does NOT install or run anything.
3. Confirm `tools/<id>/TOOL.md` parses: it appears in the dashboard **Tools** tab as a `cli` tool (not installed).
4. As owner, click **Install & trust** → the #3 Docker build runs; then `invoke` an action.
```

- [ ] **Step 2: typecheck + full suite + commit** — `npm run typecheck` clean; `npm test` all green.
```bash
git add test/e2e.manual.md
git commit -m "docs(#2b-1): manual e2e — onboard a tool via the agent"
```

---

## Self-review notes

- **Spec coverage:** resolver kernel-default ⊕ vault-override (T1) ✓; install-SOP shipped in the kernel (T2) ✓; constitution awareness + the hard rules (T3) ✓; query() injects the resolved SOP path so the agent is told where its skill is (T3) ✓; the onboarding flow — trigger=query, inspect-in-temp, author TOOL.md, owner installs via #3 — is encoded in the SOP + constitution + verified manually (T2/T3/T4); testing: resolver/footer unit-tested, agent-authoring manual (T1/T4). Success criteria 1–2 → T1/T3; 3–4 → T4 (manual); 5 → the constitution rules in T3 + the full suite staying green.
- **Out of scope (correctly absent):** the soul-split + `AGENTS.md` migration (follow-up), the full SOP library + progressive-disclosure index + learning-loop, http/mcp onboarding polish, a dedicated Onboard UI. No vault files are seeded/removed by this slice.
- **Narrow-waist:** the always-on prompt only gains a one-line footer (the SOP body loads on demand via the agent's read tool), keeping the constitution small.

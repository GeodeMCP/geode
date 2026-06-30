# Agent tool-onboarding (slice #2b-1) — design

Date: 2026-06-30

The minimal agent-core slice that lets you **ask the vault agent to onboard a repo**: the agent inspects a repo URL and writes a conforming `tools/<id>/TOOL.md`; you (owner) then review + **Install & trust** via the existing #3 flow. Builds on #2a (the `TOOL.md` model) + #3 (the Docker-sandboxed install/run). Companion: memory `executor-and-agent-core-design`.

## Goal

`query` the vault agent with *"onboard the repo at `<url>` as a tool"* → the agent reads the repo, authors `tools/<id>/TOOL.md` (a `cli` tool: source/install/bin/image/permissions/actions), and reports the proposed permissions + the handoff. The agent NEVER installs or runs code — the owner approves + the kernel installs (in Docker, #3).

## Scope

**In:** a generic **SOP resolver** (kernel-default ⊕ vault-override, per filename); the seeded **install-SOP**; the constitution's onboarding-awareness + injecting the resolved SOP path into the agent run; the agent authoring a `cli` `TOOL.md` from a repo URL.

**Out (follow-ups):** the constitution **soul-split** (immutable safety-core vs overridable behavioral layer) + routing `AGENTS.md` through the resolver — the *next* slice, same resolver; the full seeded-SOP library + progressive-disclosure index + learning-loop; http/mcp onboarding polish (the SOP mentions them, but the focus/test is `cli`/repo); a dedicated "Onboard" UI (reuse `query`/chat).

## Principles (locked, from the brainstorm)

- **Mechanism ≠ intelligence.** The kernel provides the *capabilities* + *guardrails*; the agent's *intelligence* (Agent SDK + the declarative install-SOP) figures out how to onboard a given repo. No scripted pipeline.
- **Uniform layering, one carve-out.** All behavioral files use one mechanism — kernel-default ⊕ vault-override, runtime-resolved. The single exception (a follow-up): the constitution's **immutable safety-core** stays hardcoded + non-overridable. #2b-1 wires only the install-SOP through the resolver; the soul-split/`AGENTS.md` come next via the same resolver.
- **Owner-gated execution.** The agent writes the manifest; the owner approves + the kernel runs code in Docker (#3). The agent never executes the tool.

## Component 1 — the SOP resolver + loading

- **Kernel-defaults** live in the kernel package: a `kernel-skills/` directory shipped with the repo (markdown). The install-SOP is `kernel-skills/onboard-tool.md`. Versioned + updated by us with releases.
- **User-overrides** live in the vault's `skills/` dir (git-tracked, the user's). A file there wins by name (precedence: kernel-default < vault-override).
- **Resolver** (`src/skills.ts`, new): `resolveSkill(vaultRoot, name): string` returns `<vaultRoot>/skills/<name>` if it exists, else `<kernelSkillsDir>/<name>`. `kernelSkillsDir()` resolves the shipped `kernel-skills/` next to the build. Pure + unit-testable.
- **Loading (per-run injection):** `query()` composes the effective system prompt = `deps.systemPrompt` (the constitution) **+ a short skills footer** built from the resolver — e.g. `"\n\n## Your skills\nOnboarding a tool: read ${resolveSkill(root, 'onboard-tool.md')} and follow it. Inspect repos in a temp dir (never in the vault)."`. The agent reads the SOP body **on demand** via its read tool (narrow-waist: the always-on prompt stays small; the SOP details load only when onboarding). The resolved absolute path is what's injected, so a vault override is transparently used.
- **Constitution** (`constitution.ts`, ours): gains one concise line of onboarding-awareness ("You can onboard tools/connections/MCPs for the user; when asked, follow your onboarding skill; you write the `TOOL.md` but never install or run it — the owner approves that."). The heavy schema/procedure stays in the SOP.

## Component 2 — the install-SOP (`kernel-skills/onboard-tool.md`)

Declarative guidance (NOT a step-1-2-3 script). It covers:
- **Goal + boundary:** turn a repo/CLI/API/MCP into a conforming `tools/<id>/TOOL.md`; you write the manifest, the owner approves + the kernel installs in Docker. Never run the install or the tool yourself.
- **Classify** → `http` / `cli` (repo) / `mcp`. (Repo install = `cli`.)
- **Derive by inspection** (not by asking): read README / `package.json` / `pyproject` / `Dockerfile` / OpenAPI → `source` (repo URL + pinned `ref`), `install` commands, `bin`, `image.base` (`node:20-slim` / `python:3.12-slim`), `actions` (each a `command` template + `params`), and `connections` + `requires` if it needs auth (label + secret **key names**, never values).
- **Propose least-privilege `permissions`:** the minimal `network` egress (specific hosts if known, else `none`; `any` only if unavoidable → flag it). The owner reviews these at install.
- **Hard rules (repeated):** never secret *values* in the manifest; never run the install/tool yourself; by-reference + canonical id; pin the `ref`; on ambiguity, proceed with the most reasonable assumption and state it.
- **Output + handoff:** write `tools/<id>/TOOL.md`; report concisely ("type cli, actions …, requested permissions …, needs secret(s) …; review + Install & trust to build+run").
- **A worked `cli` example** (a full `TOOL.md`) as a template.

The verbatim SOP text is authored in the implementation plan.

## Component 3 — the onboarding flow

- **Trigger:** the existing `query` path (MCP caller or dashboard chat). The owner/caller says *"onboard the repo at `<url>` as a tool."* No new trigger mechanism. The constitution-awareness + injected SOP make the agent handle it.
- **Inspect:** the agent (Agent SDK bash) clones the repo to a **temp dir** (`mktemp -d`), reads README/manifest files, removes it. **Inspection-only — no code execution** (cloning ≠ running; the real code-run is #3-sandboxed in Docker after owner approval). Not cloned into the vault (the machinery doesn't belong there).
- **Author:** the agent writes `tools/<id>/TOOL.md` into the vault, committed via the existing `query`/git flow (auto-commit for MCP; a draft for the dashboard).
- **Handoff:** the agent reports the proposed manifest + permissions; the **owner** reviews it (vault file-tree / Tools tab) and clicks **Install & trust** (#3). Clean seam: #2b-1 authors, #3 installs.

## Testing

- **Unit (TDD):** `resolveSkill` (kernel-dir + vault `skills/` → resolved path; vault wins by name; falls back to kernel default; missing → kernel default). The `query()` skills-footer composition (the system prompt contains the resolved SOP path).
- **Integration / manual (behind a gate, like the Docker eval):** a real agent run — `query("onboard the repo at <small-fixture-repo-url> as a tool")` → assert a `tools/<id>/TOOL.md` is written that `loadTool` parses as a valid `cli` manifest (and, optionally, that a subsequent #3 `installTool` builds it). Agent behavior is non-deterministic, so this is a gated integration check, not a unit test.

## Success criteria

1. `resolveSkill` returns the vault override when present, else the shipped kernel default (unit-tested).
2. An agent run's system prompt contains the resolved install-SOP path (the agent is told where its onboarding skill is).
3. Asking the agent (via `query`) to onboard a small real repo produces a `tools/<id>/TOOL.md` that `loadTool` validates as a `cli` manifest with `source`/`bin`/`actions`/proposed `permissions` — and the agent does NOT install or run anything.
4. The written manifest then installs via the existing #3 owner flow.
5. No regression; the constitution's safety rules (never secrets, never execute) are intact.

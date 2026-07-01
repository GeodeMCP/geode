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
- `actions`: the operations to expose; each a `command` template + `params`. `command` is an argv array — one token per element, never a single shell string; put an interpolated value like `${params.url}` in its own element.
  - **Prefer the tool's documented CLI subcommand** over a hand-written inline interpreter script. If the README / `--help` shows a command for the operation (`tool fetch --url …`), make that the action `command`. Fall back to an inline `python -c "…"` / `node -e "…"` only when the tool exposes no CLI for it — and say so as an assumption in your report. An inline script is a *guess* about the library's API: brittle across versions, and it interpolates `${params.*}` into source code (a wider injection surface) rather than passing them as discrete argv tokens.
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
    command: ["fetch", "--url", "${params.url}"]
---
Use `invoke(cloakbrowser, fetch, { url })`. Owner installs via "Install & trust".
```

**Avoid** authoring an action as an inline interpreter script when a CLI exists — prefer `command: ["fetch", "--url", "${params.url}"]` over `command: ["-c", "from cloakbrowser import launch; launch().goto('${params.url}') …"]`. The latter guesses the library API and interpolates an untrusted value into source.

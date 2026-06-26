# Tool-supply & caller-surface — decisions

Date: 2026-06-26

Captures the decisions from the caller-surface session: what Geode is, how the vault becomes a native part of any AI caller's process, and how integrations/repos/MCPs live in the vault. Companion docs: caller-surface eval design + results (`2026-06-26-mcp-caller-surface-eval-design.md`), eval plan (`../plans/2026-06-26-mcp-caller-surface-eval.md` + `-v2-hardening.md`), and the north-star (`2026-06-17-context-vault-architecture.md`, §2.1 reversed by this work).

## 1. Proposition

> **Your assistant is replaceable. Your context, SOPs, integrations, and credentials shouldn't be.**
> Geode is the neutral context-and-tools hub between you and any assistant — set it up once, plug in any assistant.

- Solves **fragmentation**: today context + tools + credentials are scattered per assistant; Geode collapses them to one owned hub that outlives tool churn. Assistant-churn is the tailwind, not the threat.
- Hardest moat = the **credentials/integrations broker** (assistants can't own your keys); context/SOPs are the soft edge.
- **Three layers:** **own** (your git-backed vault) · **connect** (one MCP endpoint, server-side credential injection, can aggregate other tools/MCPs) · **managed** (you/resellers host & manage vaults for companies, optionally on local hardware + local models — the compliance/on-prem wedge clouds can't match; open-core, multi-tenant/governance = paid).

## 2. Principles

- **Provider, not substitute.** The vault supplies *context* + *tools*; the **caller** performs. We never act on the caller's behalf in the outside world.
- **Internal agent = inward only, fixed.** Its remit is `remember` + *organising* files/tools inside the vault. This is what makes raw reads safe (see §4 canonicality).
- **Everything actionable funnels through `invoke`** — one door regardless of executor.
- **Tool-agnostic is the differentiator.** Must work across Claude, Claude Code, Cursor, Hermes, OpenClaw, and future tools — including weak/local models on reseller hardware.

## 3. The caller surface (how the vault becomes native)

The fluid loop = four verbs: **discover → pull → act → capture.**

| Verb | Tool(s) | Notes |
|---|---|---|
| discover | `list_capabilities` (tiered: L1 map → L2 per-tool drill-down) | context index + every tool with connections + status; cheap; "call first" |
| pull | `search`, `read` | cheap raw retrieval — the caller reads + reasons itself (no sub-agent) |
| act | `invoke(tool, action, params, connection?)` | universal door; server injects the chosen connection's secret |
| capture | `remember` | caller gives the essence; internal agent files it |
| (escape) | `query` | heavyweight vault-agent synthesis — **last resort**, de-emphasized |

**Does the caller need an instruction every time? No.** A one-time, invisible mechanism does it: the server `instructions` field + (more importantly) tool **descriptions written as trigger-situations**. The user talks normally; the surface makes the agent reach in.

**Eval verdict (measured, not guessed — see eval spec §Results):**
- **Discovery is carried by rich tool DESCRIPTIONS, not the server-`instructions` nudge** (isolation config proved the nudge ≈ no-op when descriptions are good). Keep the nudge (harmless) but invest in descriptions.
- **Query-only is the worst surface for small models** → ship cheap reads, not a query-only surface.
- **Recommended surface = "F-read-nudge":** cheap `read`/`search` + tiered `list_capabilities` + rich trigger-situation descriptions + an instruction that explicitly says *after list/search, read the specific file before answering* (lifts weak-model retrieval at no cost). `query` retained as last resort. Tiered list > flat for invoke-precision.
- No config ever over-triggers on irrelevant prompts.

## 4. Tool-supply model (integrations / repos / MCPs in the vault)

**One tool abstraction · three executors · one `invoke` door.** Everything actionable is a *tool* with connections + actions; only the server knows how it runs:

| Soort | Executor | Caller sees |
|---|---|---|
| HTTP integration (Linear, Stripe) | HTTP request, `${secrets}` injected | `invoke(linear, create_issue, …)` |
| Installed repo/CLI (CloakBrowser, gogcli) | subprocess + env/profile injection | `invoke(gmail, send, …, connection: …)` |
| MCP server (GitHub-MCP, Playwright-MCP) | geode proxies the external MCP | `invoke(github, open_pr, …)` |

- **Layout:** tools live at `tools/<id>/manifest.json` (generalises the current `integrations/`). Manifest = canonical *how*: `id, name, type: http|cli|mcp, description, connections[], actions{}`.
- **Secrets never in the vault.** They live in the encrypted secret store (outside git), keyed per connection. The manifest names only connection **labels**; `list_capabilities` shows labels + descriptions + **status** (`connected` / `needs_reconnect`), never values.
- **References by canonical id, never copied.** SOPs/skills point with frontmatter `uses: [gmail.send]` + `[[tool:gmail]]`; change the tool → update only the manifest; every SOP stays correct. Same discipline for context (`[[context/company-z/tone]]`). → `list_capabilities` is *derived* from the filesystem, not hand-maintained.
- **Multi-connection** (one `gmail`, several accounts): caller picks **by intent**; the server materialises that connection's credentials — env vars for token CLIs, or an ephemeral profile dir (`HOME=<dir>` / `--config <dir>`) for CLIs that read from disk.
- **OAuth = supply-side only, never the caller.** Setup (one-time interactive consent) + token storage per connection + refresh-at-invoke happen server-side; the caller's `invoke` is identical whether auth is an API key or OAuth. This is **outbound** OAuth (geode → Google), distinct from the existing **inbound** OAuth (claude.ai → geode-as-owner). Token bundles are captured into *your* encrypted store (exportable) — "credentials shouldn't be trapped" holds for OAuth too. (Ties to the parked installer, north-star #5.)
- **Connection health surfaces to the caller:** a stale/broken connection → an **actionable error** ("connection X needs re-authorization — owner must reconnect in geode"), not a raw 401.
- **MCP aggregation v1 = proxy-through-`invoke`** (external MCP tools appear as geode actions via the same door — uniform, no tool-explosion, weak-model-friendly). **Vault-as-hub** (re-exposing them as first-class MCP tools) is a phase-2 candidate, gated on eval evidence.

## 5. Decomposition roadmap

One mega-plan would break simplicity-first; build per slice, detailed plan each:
1. **Eval harness** *(done — `evals/`)* — locks the surface by measurement.
2. **Manifest + layout generalisation** — `integrations/`→`tools/`, `type`/`connections`/`auth` block; secret-store → credential-bundles.
3. **Executors** — subprocess/CLI runner (materialisation) · MCP-proxy client.
4. **Outbound-OAuth installer** (north-star #5, parked).
5. **Surface implementation** — cheap `search`/`read`, tiered `list_capabilities`, server `instructions`, connection status/errors — per the eval verdict (the F-read-nudge surface).

## 6. Out of scope / deliberately deferred

- LLM answer-quality judge for the eval (trace-based scoring only, for now).
- Vault-as-hub first-class tool re-exposure (phase-2).
- The "organized registration" UX for installing repos/CLIs/MCPs + setting up connections (slices 2–4 above).

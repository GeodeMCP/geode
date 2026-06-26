# MCP caller-surface eval — design

Date: 2026-06-26

## Goal

Find the **best set of MCP tools (+ descriptions + server instructions)** that makes the Geode vault an optimal part of *any* caller agent's process — Claude Code, Claude.ai, Hermes, OpenClaw, future tools. "Best" is measured, not guessed, via a rerunnable eval harness we iterate on until scores plateau.

## Principles (what Geode is)

- **Provider, vault, hub in the middle of all your assistants** — present and future ones you switch to. Tool-agnostic is the differentiator.
- **Supplier, not substitute.** Vault provides *context* + *tools*; the **caller** performs. We never act on the caller's behalf in the outside world.
- **Internal agent = inward only, and fixed.** Its remit is `remember` + *organising* files/tools inside the vault. Not part of the optimization.
- **Everything actionable funnels through `invoke`.** Connection, installed repo/CLI, MCP → caller calls `invoke`, a process runs server-side (HTTP **or** subprocess), a result returns. Internal agent organises *what's invokable*; caller decides *when*.
- **A tool can have many credentialed connections.** e.g. one `gmail` tool, 3 connections (private / company A / company B). Caller picks *by intent* ("email Josh from company B"); server injects that connection's secret. Context composes with the action (sales pipeline + company-Z tone-of-voice drive the send).

## Fixed vs under test

**Fixed (every config):** `remember`, internal organise, `invoke` (universal action-runner), some discovery surface.

**Under test (two axes):**
1. **Context-read primitives** (mix & match): `list_capabilities`/tree (discover) · `read(path)` (cheap raw read) · `search(query)` (cheap retrieval) · `query` (heavyweight synthesis) · MCP **resources** (host-attachable files).
2. **Tool-discovery**: how the caller learns which connection/MCP/repo to `invoke` and with what params — `list_capabilities` alone vs. richer per-tool schema exposure.

Plus **server `instructions`** (the nudge) and tool **descriptions** as per-config knobs.

Search space stays **open** to new tools — including the vault re-exposing whole MCP servers as proxied tools (**vault-as-hub**) — provided they fit the principles. Hub is a phase-2 candidate, added if the scorecard shows discovery/invoke still weak with the core palette.

## Configs to test (v1)

The **leading candidate** ("fluid 4-core + optional"):
- `list_capabilities` — tiered: L1 = context-index (categories + 1-line summaries) + tools (name, 1-liner, connection **labels + status**); L2 = `list_capabilities(tool)` → actions + param schemas.
- `search(query)` — cheap raw retrieval (snippets + paths).
- `read(path)` — cheap exact read.
- `invoke(tool, action, params, connection?)` — universal door; **actionable errors** (e.g. "connection companyB needs re-authorization").
- `remember(content, source?, title?)` — capture.
- `query(instruction)` — heavyweight synthesis, described as **last resort**.
- non-empty server `instructions` — the invisible nudge; trigger-situations also redundantly in tool descriptions.

Pitted against it:
- **B — query-only baseline** (current 4 tools, empty `instructions`, flat `list_capabilities`) — the status quo / north-star §2.1 stance.
- **C — search-only** (drop `read`).
- **D — flat `list_capabilities`** (else = leading).
- **E — minimal descriptions** (no trigger-situations) vs leading's rich ones.
- Each config run across both caller capability tiers (strong + weak/local).

> Note: this exercise re-opens north-star §2.1 ("no `find` tool — all access via `query`"). That stance is **under test**, not yet overturned; §2.1 gets a "under-test" annotation and is updated with evidence *after* this eval (see "tests first, then docs"). Canonicality is preserved by the organise-discipline (internal agent keeps the vault canonical), which makes raw cheap reads safe — but whether they *win* is what we measure.

## Harness architecture

**Only the caller is a real model. Everything else deterministic.**

1. **Caller runner** — lightweight real-model tool-use loop. Connects to the kernel, fetches the *actual* registered tools + server `instructions` (test the real surface, not a copy), sends one scenario prompt, records the full **tool-call trace** (tool, args, order). The caller is the *only* real model, and it varies on two axes:
   - **system prompt** — "bare assistant" vs. "Claude-Code-like agent".
   - **model capability tier** — a strong model (e.g. Sonnet/Opus) **and** a weak/local-class model (e.g. Haiku, standing in for the 7B-class models resellers run on local hardware). **Weak-model legibility is differentiator-critical** (B2B local-models motion) — a surface only strong models discover is a failed surface, so this axis is first-class, not optional.
2. **Stub engine** — `QueryDeps.engine` is injectable; inject a fake. `query` returns canned deterministic text. `remember` performs a *deterministic write* (predictable file) so store→retrieve scenarios have ground truth — without invoking a real model. We score caller behavior, not the internal agent's filing quality (settled, separate).
3. **Fixture vault** (`evals/fixtures/vault/`) — small committed vault. Context: `sops/`, `clients/acme/preferences.md`, company-Z `tone-of-voice.md`, sales-pipeline note, `index.md`. Tools under `tools/<id>/manifest.json` (one tool, three executors — uniform `invoke`): `gmail` (`type: cli`, **multi-connection** private/A/B, each with a *status* label), `linear` (`type: http`), `cloakbrowser` (`type: cli`/repo), `github` (`type: mcp`, proxied). SOPs reference tools by canonical id (`uses: [gmail.send]` / `[[tool:gmail]]`), never copying action details. Each run = throwaway temp copy; nothing commits to the real repo.
4. **Config** (`evals/configs.ts`) — `{ name, toolset, toolDescriptions, serverInstructions, listCapabilitiesMode }`. `listCapabilitiesMode` = `flat` vs `tiered` (L1 map → L2 per-tool drill-down) is itself a knob. Harness boots the kernel per config.
5. **Scenarios** (`evals/scenarios.ts`) — `{ id, prompt, class, expect }`. Multi-leg supported (store leg then retrieve leg over the same temp vault).
6. **Scorer** — pure `(trace, expect) → metrics`. No LLM judge.
7. **Runner + scorecard** — matrix `config × scenario × N repeats` → aggregated **rates** per config (4/5, not pass/fail; tool-calling is stochastic). Prints table + writes JSON (future optimizer consumes it). Run via `npm run eval`. **Excluded from CI/husky** (slow, costs tokens, nondeterministic).

## Scenarios (anchor = cross-tool journeys)

- **Store→retrieve (memory portability), two-leg.**
  - Leg 1 (tool A): "We deploy staging with `fly deploy -a acme-staging`, smoke `npm run smoke`." → expect `remember`.
  - Leg 2 (tool B, fresh, no local memory): "Deploy staging." → expect discover + read vault, **without** user saying "check geode".
- **Tool portability.** `Linear` connection registered earlier; later "file a Linear issue for this bug" → expect discover + `invoke` (right action+params), not an invented call.
- **Multi-connection disambiguation.** "email Josh from company B" → expect `invoke` gmail with the **company-B** connection (not private/A).
- **Context + tool compose.** (openclaw) "run the sales pipeline for this lead" → expect pull pipeline + company-Z tone context, then perform/invoke in that voice.
- **Installed-repo tool.** (Claude Cowork) task needing a bot-resistant browser → expect discover + `invoke` `cloakbrowser`, not a hand-rolled fetch.
- **Should-use direct.** "what's our eslint convention" → expect discover + retrieve.
- **Negatives (over-trigger guard).** "what's 2+2", "write fizzbuzz" → **zero** vault calls.

## Metrics (per config, as rates)

- `discovered` — reached into vault when it should.
- `correctRetrieval` — read/surfaced the right file/topic.
- `correctInvoke` — right integration + action + params + **connection** (right account).
- `falseTrigger` — any vault call on a negative (penalized).
- `remembered` — called `remember` when appropriate.
- (derived) `cost proxy` — count of heavyweight `query` calls vs. cheap reads (prefer cheap).

"Best config" = high discover/retrieval/invoke/remember, low falseTrigger, low heavyweight-call count.

## Out of scope

- Organised registration of real connections/MCPs/repos (separate downstream feature; eval uses fixtures).
- Answer-quality LLM judge (possible phase-2 secondary metric).
- CI integration.

## Success criteria

1. `npm run eval` runs the full matrix and prints a scorecard + writes JSON.
2. Baseline (current 4 tools, empty instructions) scores measurably worse on `discovered` than at least one candidate config → proves the harness discriminates.
3. Adding/removing a tool or editing instructions changes the scorecard reproducibly → we can iterate to "the way".
4. The scorecard is broken out **per caller tier** (strong vs weak/local) so we can see whether the winning surface survives on small models, not just strong ones.

## Results & verdict (2026-06-26)

Ran v2 (hardened: ambiguous discovery scenarios + scaled fixture of 9 tools / 17 files + `turns`/`toolResultChars` cost metrics) across 5 configs × strong/weak × 3 repeats (n=36 legs/cell, 0 failures), plus a focused weak-tier run adding two isolation configs (F = leading + explicit "read the located file" instruction; G = leading + empty server instructions).

**Findings (weight `false`/`invoke`/cost/discovery over `retr` — trace-`retr` rewards verbose dumping, which doesn't scale):**
- **Safe:** zero over-triggering on negatives, every config, both tiers — adding the nudge + cheap tools never makes the agent paw at the vault on irrelevant prompts.
- **Query-only is the worst surface for weak/local models** — lowest invoke-precision (~50–58%), under-discovers (~83–88%), most context flooding (~2100–2800 chars). Cheap-reads configs win. (Empirical backing for the §2.1 reversal.)
- **Discovery is carried by rich tool DESCRIPTIONS, not the server-`instructions` nudge.** Isolation config G (leading surface, empty instructions) still discovered 100% on weak; B's discovery drop came from jargon descriptions + query-only, not from missing instructions. Keep the nudge (harmless, may help unmodeled cases) but invest in descriptions. → "Must the user say 'check geode'?" = **no**, and it's the descriptions that make the agent reach in.
- **`read`-step instruction helps small models:** F lifted weak-tier retrieval ~+10pp over leading at no cost (still 100% discovery, 75% invoke, 0 heavy-query, lean).
- **Tiered > flat list** for invoke-precision; flat floods context.

**Recommended surface = "F-read-nudge":** cheap `read`/`search` + tiered `list_capabilities` + rich trigger-situation descriptions + a server instruction that explicitly says *after list/search, read the specific file before answering*; `query` retained as last resort.

**Caveats:** trace-based scoring can't measure answer *quality* (the LLM-judge was deliberately out of scope); ~±10pp run-to-run noise at n=36; the stub `query` is unrealistically generous (full-body dump), flattering query-only. Full decision write-up: `specs/2026-06-26-tool-supply-and-caller-surface-decisions.md`.

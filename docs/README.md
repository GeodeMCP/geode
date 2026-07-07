# Geode — docs

> **Your assistant is replaceable. Your context, SOPs, integrations, and credentials shouldn't be.**
> Geode is the tool-agnostic vault in the middle — set it up once, plug in any AI assistant over MCP.

## What Geode is

A **provider, not a substitute.** One vault you own — your context, SOPs, integrations and credentials — reachable by *any* AI caller (Claude Code, Claude.ai, Cursor, Hermes, OpenClaw, whatever comes next) through a single MCP endpoint. No more fragmented context-and-tools scattered per assistant: one place that holds everything, that you keep when you switch tools.

Three layers:

1. **Vault (own)** — your context + tools + credentials, git-backed, yours. Plain files; take them and leave at any time.
2. **Hub (connect)** — one MCP endpoint every assistant plugs into. Credentials are injected **server-side**, so no assistant ever sees your keys.
3. **Managed (monetize)** — host/manage vaults for others (optionally on local hardware + local models for privacy), open-core: kernel free, multi-tenant/managed paid.

## The model (how it works)

- **The caller performs; the vault supplies.** The vault gives context and prepares tool calls; the **caller** executes them. We never act in the outside world on the caller's behalf.
- **The internal agent is inward-only:** its job is `remember` + *organising* the vault. It never calls integrations.
- **Everything actionable funnels through `invoke`:** an HTTP connection, an installed repo/CLI, or an MCP — the caller calls `invoke`, a process runs server-side (with the right connection's secret injected), a result comes back. One tool can hold many credentialed connections (e.g. 3 Gmail accounts), picked by intent.
- **The caller-facing surface** (discover → pull context → act → remember) is being optimised empirically — see the eval-surface spec below.

## Where to look

| Doc | What it is |
|---|---|
| [`../README.md`](../README.md) | Run / operate the kernel (env, first-run account, OAuth connect). |
| [`superpowers/specs/2026-06-17-context-vault-architecture.md`](superpowers/specs/2026-06-17-context-vault-architecture.md) | **North-star architecture** — value prop, the agent-in-the-middle boundary, OKF context format, secret broker, distribution/open-core, build order, cross-cutting design. Start here for the full picture. |
| [`superpowers/specs/2026-06-26-mcp-caller-surface-eval-design.md`](superpowers/specs/2026-06-26-mcp-caller-surface-eval-design.md) | **Current direction** — the eval harness for finding the best caller-facing tool surface (discover/pull/act/remember + server instructions), and the toolset under test. |
| [`superpowers/specs/`](superpowers/specs/) | Per-feature design specs (dated). Each feature = spec → plan → build. |
| [`superpowers/plans/`](superpowers/plans/) | Implementation plans matching the specs. |
| [`design/geodemcp-visual-style.md`](design/geodemcp-visual-style.md) | Visual style spec for the dashboard / all UI (dark, emerald+blue). |
| [`design/mockups/`](design/mockups/) | Canonical dashboard mockups. |

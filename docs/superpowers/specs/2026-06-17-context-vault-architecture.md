# Context Vault — Architecture Overview

> Status: **Draft, updated 2026-06-18.** North-star document. Each sub-project gets its own
> spec → plan → build cycle. Detailed specs: kernel `2026-06-17-kernel-design.md`, context-tools
> `2026-06-17-context-tools-design.md`, secret-broker/invoke/artifacts (the v1-core completion)
> `2026-06-17-secret-broker-design.md`. Visual style: `docs/design/geodemcp-visual-style.md`.
>
> **Naming note (2026-06-18):** the agentic tool is **`query`** (renamed from `delegate`, now that
> the vault researches/plans and never executes). The mechanical `find` tool was **removed** — all
> context access goes through `query` (the specialized agent). Already-built code (kernel + #2) still
> uses `delegate`/`find`; the rename + removal + the capabilities revision are applied in the v1-core
> completion cut (#3).

## 1. Value proposition

AI tooling churns fast — today Claude Code, tomorrow OpenClaw, Hermes agent, the next thing. Your
context, ways-of-working, and connections should not be trapped inside any one of them.

**This product (the "Geode vault") is the durable, tool-agnostic substrate beneath the churning
agent ecosystem.** Your context lives in your own vault, reachable through a universal MCP endpoint,
so every new AI client instantly inherits your accumulated context and tools with zero migration.
The vault is the constant; AI front-ends are interchangeable, swappable consumers. You never reinvent
the wheel when a new tool appears — and it *compounds*: every use enriches the vault, so switching
tools never resets you to zero.

This reframes the product from "another context/memory store" toward "own the context layer." It is
the strongest differentiator and the lens for all positioning.

## 2. The core insight — agent-in-the-middle

This product exposes **a specialized agent that sits next to your context**. A caller (Claude Code,
Cursor, ChatGPT) asks in natural language; the vault's agent reasons over your files, recipes, and
SOPs and returns a synthesized answer or an **executable plan**. The caller needn't know the vault's
internal structure — it expresses intent and the agent navigates.

**The boundary (decisive).** The vault is the **operator of your recipes and kitchen equipment** — it
gives context, looks things up, offers skills/SOPs, and explains *how* to use your tools. It **does
not execute external actions.** The **caller executes** (via `invoke`). So the vault is your
*specialized* context+tools layer, not a competing general agent — which keeps the value-prop intact
(the vault is the constant; the executing front-ends are swappable).

A powerful consequence: **the agent never touches secrets.** It only plans, which needs the
integration *manifest* (action + param shapes), never the credential. Secrets live only in the broker
and are injected server-side at the moment the **caller** calls `invoke`. "Hide secrets from the
agent" becomes trivial — the agent has no reason to hold them.

### 2.1 Operations (v1 surface)

Four operations — everything else (raw file access) goes **through** the agent (`query`), keeping the
surface small and always-synthesized. Each MCP description names the "Geode vault" so callers route
intent reliably.

| Tool | What it does | Cost | Who works |
|---|---|---|---|
| `query` | the specialized agent: searches/finds your context, synthesizes an answer, **or** returns an executable plan (ordered steps + the exact `invoke` calls & values). **Does not execute external actions.** | expensive | vault agent |
| `invoke` | **the caller** runs one action of an integration; the broker injects the secret server-side and returns the result (+ an artifact URL if it produced a file). | medium | caller |
| `remember` | save/update knowledge in the vault (ingest: integrated + committed). | medium | vault agent |
| `list_capabilities` | the menu: what the vault offers (recipes/skills + integrations & their actions), **derived** from OKF frontmatter + manifests. | cheap | — |

**Who does what.** `query` is the front door: *"how do I do X with my vault?"* → it finds the steps +
integrations and returns a ready-to-run plan; the **caller executes** that plan with `invoke`.
`list_capabilities` is discovery; `remember` is the save-back. The vault agent operates only **within
your vault** (read / organize / plan + bash to inspect); it never calls integrations — that's the
caller's job. There is **no mechanical `find` tool** — asking the agent (`query`) for content always
returns canonical, synthesized results (no stale raw greps), at the cost of an agent run for trivial
reads (an accepted trade for simplicity + always-through-the-specialist).

*Open mechanic for `invoke` (deferred):* expose each integration's actions as their own MCP tools, or
one generic `invoke(integration, action, params)` + discovery (current lean: the latter).

### 2.2 Context format — Open Knowledge Format (OKF)

The vault adopts **OKF** (Google Cloud's vendor-neutral markdown spec) as its context convention,
rather than bespoke rules — it is almost exactly what we independently designed:
- **Markdown files with YAML frontmatter; one concept per file; the file path is its identity.**
- Reserved frontmatter: **`type` (required)** + `title`, `description`, `tags`, `timestamp`, `resource`.
- Concepts link to each other with markdown links → a knowledge graph (our canonical-sources + cross-refs).
- **`index.md`** (progressive disclosure) + **`log.md`** (change history) — which we already use.
- Vendor-neutral, parseable with standard tools, no SDK/registry.

Benefits: a standard instead of bespoke conventions; interoperability (ingest/emit OKF bundles; other
OKF tools can read our vault); and it makes discovery **derivable** (see §5.6). Recipes/skills are OKF
concepts (`type: recipe` etc.); integrations have manifests (§5.7).

## 3. Distribution model (open-core)

- **Now:** an open-source, self-hostable kernel. Single-tenant per installation. No accounts,
  multi-tenancy, or billing.
- **Later (commercial):** a hosted SaaS — see §3.1.

Design rule: build the single-tenant self-host kernel now, but make choices that do not *preclude* the
hosted future (HTTP-first transport, externalized config, **Docker-packaged kernel**, **per-instance
token auth**). Explicitly defer multi-tenancy, accounts, per-user auth, and billing.

### 3.1 SaaS / hosted track (the monetization path)

Subscription accounts where we manage the customer's runtime, with a **local-model option for ultimate
privacy** as a premium add-on (your context, your model, nothing leaves your environment) — a strong
wedge for businesses / regulated sectors.

Two principles keep this *additive*, not a rewrite:
- **Isolated instances × N, not shared multi-tenancy.** Each customer = their own isolated container
  running the same kernel + own vault + own MCP endpoint + own secrets. Exactly our "hard isolation =
  endpoint + token per workspace" model (§5.5) and the broker's container boundary (§5.8).
- **Control plane / data plane split.** The kernel is the **data plane** (per-tenant runtime); the
  SaaS adds a thin **control plane** (accounts, billing, provisioning, routing). The kernel stays clean.

Local model is enabled by the model-connector seam (§5.10). **Honest cost:** hosting arbitrary
per-tenant code execution needs serious sandboxing/egress/abuse controls (cf. e2b / Daytona / Modal).
**Sequencing: kernel-first, NOT platform-first.**

## 4. Decomposition & build order

1. **Kernel** — MCP server exposing the agentic **`query`** over a git-backed workspace, sync + live
   progress, single-flight, git commit-on-success/reset-on-failure, model-connector (local + cloud).
   *(Built as `delegate`; renamed to `query` + `find` removed in #3.)*
2. **Context tools** — `remember` (ingest) + `list_capabilities` + vault seeding + enriched
   constitution. *(Built 2026-06-17; `list_capabilities` is revised to **derive** from OKF frontmatter +
   manifests in #3, replacing the hand-maintained `capabilities.md`.)*
3. **v1-core completion (broker + `invoke` + integration + artifacts)** — encrypted secret store +
   server-side injection; caller-only `invoke`; ONE sample HTTP integration + the manifest format; an
   **artifacts** store + URL serving; plus the cross-cutting `delegate`→`query` rename, `find` removal,
   and the OKF-derived `list_capabilities` revision. *(Current cut — completes the v1 core.)*
4. **Dashboard** — web UI (chat / file-tree + viewer / event-feed), realtime, git history. *(Core
   layout + realtime validated; detail spec later. Hosts the signed auth-link + auth screen, §5.9.)*
5. **Integrations installer** — OAuth flows, repo/CLI install, the signed auth-link, more integration
   types (the `invoke` surface + first sample land in #3). Depends on #3 + #4.
6. **Multi-workspace** — multiple workspaces with inheritance, optionally their own MCP endpoints.

## 5. Cross-cutting architecture

### 5.1 The vault
One git-backed directory holding your context. Git is also the **concurrency + safety mechanism**:
each agent run is a commit; writes serialize; every state is recoverable.

### 5.2 The constitution (two tiers)
1. **Immutable engine core** — the system prompt the kernel injects into every run: maintain a
   structured vault, follow the `AGENTS.md` schema, keep `index.md`/`capabilities`(derived inputs)
   /`log.md` current, OKF frontmatter on concepts, canonical facts referenced not copied, never write
   secrets, **never call integrations — return `invoke` plans for the caller instead.**
2. **Evolvable per-workspace schema** — `AGENTS.md` in the vault: folder map, domain conventions, IDs.
   Co-evolves with the user.

### 5.3 Structural files (OKF-based)
| File | Role | Maintained / derived |
|---|---|---|
| `AGENTS.md` | the schema: folder map + rules + IDs (OKF "index" of conventions) | agent + user |
| `index.md` | OKF index: catalog of concepts with one-line summaries + links | agent, every change |
| `<concept>.md` | an OKF concept: YAML frontmatter (`type`, `title`, `description`, `tags`) + body | agent + user |
| `log.md` | OKF change history, append-only, grep-able (`## [2026-06-18] …`) | agent, every action |
| `integrations/<name>/manifest.json` | machine-readable integration spec (actions, `requires` refs) | agent/user (installer) |

There is **no hand-maintained `capabilities.md`** — discovery is **derived** (§5.6).

### 5.4 Inheritance — "rules cascade, facts are canonical"
- **Rules/conventions** cascade down the schema chain (`root → company → project`); defined once high.
- **Facts/content** are **canonical**: one file, referenced by link, never copied (OKF link graph).

### 5.5 Multi-workspace
Companies/projects are top-level workspace folders under a lean account-wide root (`vault/AGENTS.md`,
`_shared/`, `acme-corp/`, `globex/`). Same cascade, one level up. Isolation spectrum: **soft** (1
endpoint, scope by convention) → **scoped** (`query`/`invoke`/etc. take a `workspace` param) → **hard**
(endpoint + token per workspace). **Decision:** start soft, build the `workspace` seam into the tools
now. The broker, artifacts, and discovery must all be **workspace-scoped** (a seam now, hard later).

### 5.6 Discovery — derived, not hand-maintained
`list_capabilities` computes the menu **on demand** from the real state, so it can't drift:
- **Integrations** ← `integrations/*/manifest.json` (authoritative: name, description, actions).
- **Recipes/skills** ← OKF concepts (markdown + frontmatter `type`/`title`/`description`); scan frontmatter.
Returned as a structured + human-readable menu. The agent keeps the *source files* current; the menu
is always a true reflection of them.

### 5.7 Integrations
Live per workspace under `integrations/<name>/` with a manifest: what it does, its **type**
(`connection` = authenticated external service; later `mcp-server`/`cli`/`script`), its **actions**
(method/url/headers/query templates), and the **secret refs** it needs (`requires: [NOTION_TOKEN]`) —
never the value. The agent reads manifests to build `invoke` plans; the **caller** calls `invoke`.

### 5.8 Secret broker
The vault agent never calls integrations (§2) — **the agent never needs a secret.** Secrets are used
in exactly one place: the **caller**'s `invoke` → the **kernel server** fetches the secret from the
broker, injects it into the outbound request, returns only the result. **Store:** outside the vault
(never in git), **encrypted-at-rest (AES-256-GCM)**, workspace-namespaced; key from `GEODE_SECRETS_KEY`
or a generated `0600` key file. **Injection:** API integrations inject auth into the outbound HTTP call
(first cut); CLI tools spawn with the secret in the child env (later, weaker → wants the OS/container
boundary). **Isolation, honestly:** in-server suffices for self-host (agent uninvolved); a determined
bash agent on the same user could still dig — best-effort now, hardened by the OS/container boundary in
the hosted layer. First-cut secrets are added via a **CLI** (the signed auth-link + screen land in #4).

### 5.9 Auth flow — unified screen + signed capability link (deferred to #4)
Adding any credential (API key or OAuth) goes through one **auth screen** (the human-facing front of
the broker). The flow: an installer declares `requires NOTION_TOKEN` → a **signed, scoped, short-lived,
single-use** link is returned → the human enters the key / completes OAuth → it goes straight into the
broker (encrypted at rest). The link **never carries the secret — it requests one.** *(v1 uses the CLI
instead; this lands with the dashboard, #4. The same signed-link pattern also powers public artifact
URLs, §5.12.)*

### 5.10 Model-agnosticism (local + cloud)
The runtime never hardcodes a provider; it reads a **model-connector** config (base-URL/auth/model-id/
flags). Local: Ollama (Anthropic API native ≥0.14.0) / LM Studio via a LiteLLM shim. Cloud: Anthropic /
Bedrock / Vertex native; GPT/Gemini/DeepSeek/Azure via LiteLLM's `/v1/messages`. (Pin a clean LiteLLM.)

### 5.11 Dashboard (core)
Validated 3-zone web UI: top bar (workspace switcher + event-feed + account); left chat (with the vault
agent); right file-tree + file viewer. Realtime: **A** live diff in the viewer, **C** change-cards in
the chat, **B** tree status badges. Git underpins history. Detail spec later. Visual style:
`docs/design/geodemcp-visual-style.md` (dark, emerald+blue, OKF/SVG icons, no emoji).

### 5.12 Artifacts (download-able outputs)
`query` can produce an artifact (report, export, chart) and an `invoke` can return a file. MCP results
are text/structured, so artifacts are stored + served over a **URL**:
- **Store:** `artifacts/` in the workspace, **gitignored** (the agent writes there cwd-relative; not
  committed → no git bloat). `query`/`invoke` outputs land here.
- **Serve:** kernel route `GET /artifacts/<path>`. **Default = bearer-auth** (download with your token).
  **Opt-in = public signed URL** — a signed, unguessable, optionally-expiring URL (no token) to share
  externally, reusing the §5.9 signed-link pattern.
- **Return:** a file-producing `query`/`invoke` result includes `{ artifact: "<path>", url: "<download URL>" }`.
- **Path-safe:** serves only within `artifacts/` (no traversal). *Seam:* artifact URLs + public-signing
  must be workspace/tenant-scoped (hard later).

## 6. Deferred / open
- Signed auth-link + auth screen + OAuth → #4. CLI-spawn / mcp-server / script integration types, the
  repo/OAuth installer, per-action typed tools → #5. Hard OS/container isolation, workspace-scoped
  namespaces → hosted layer. Autonomous "lint" (self-maintenance). Letting the agent execute via
  integrations (Path 2) — **out by design** (§2).

## 7. Inspiration / standards
- **Open Knowledge Format (OKF)** — Google Cloud's vendor-neutral markdown+frontmatter spec for curated
  agent context; adopted as the vault's context convention (§2.2).
- Karpathy, "LLM Wiki" — persistent compounding markdown wiki; schema + index + log; ingest/query/lint.
- RinDig, "Content-Agent-Routing-Promptbase" — separation-of-concerns; Canonical Sources pattern.

# Context Vault — Architecture Overview

> Status: **Draft (brainstorm output, 2026-06-17).** This is the north-star document.
> It captures the whole picture and the build order. Each sub-project gets its own
> detailed spec when we tackle it. The kernel (sub-project #1) is specced separately
> in `2026-06-17-kernel-design.md`. Visual style: `docs/design/geodemcp-visual-style.md`.

## 1. Value proposition

AI tooling churns fast — today Claude Code, tomorrow OpenClaw, Hermes agent, the next thing.
Your context, ways-of-working, and connections should not be trapped inside any one of them.

**This product (the "Geode vault") is the durable, tool-agnostic substrate beneath the
churning agent ecosystem.** Your context lives in your own vault, reachable through a universal
MCP endpoint, so every new AI client instantly inherits your accumulated context and tools with
zero migration. The vault is the constant; AI front-ends are interchangeable, swappable
consumers. You never reinvent the wheel when a new tool appears — and it *compounds*: every use
enriches the vault, so switching tools never resets you to zero.

This reframes the product away from "another context/memory store" toward "own the context
layer." It is the strongest differentiator and the lens for all positioning.

## 2. The core insight — agent-in-the-middle

Most MCP integrations expose a fixed list of tools. This product instead exposes **an agent
that sits next to your context**. A caller (Claude Code, Cursor, ChatGPT) delegates an
open-ended instruction; our agent reasons over your files, runs scripts, calls connected tools,
and returns a synthesized result.

This is *MCP-as-agent-handoff* rather than *MCP-as-tool-list*. It also dissolves most of the
"discovery" problem: the caller does not need to know the vault's internal structure; it
expresses intent, and our agent navigates the structure itself.

### 2.1 Operations — caller as orchestrator

User journeys (Perplexity standalone, Perplexity-on-context, retrieve a skill/workflow, the
Moneybird bookkeeping workflow) revealed four distinct operations, plus discovery. **Each MCP
tool description names the "Geode vault"** so a caller routes intent reliably (e.g. "add this to
my Geode vault" → `remember`).

| Tool | What it does (MCP intent) | Cost | Who reasons |
|---|---|---|---|
| `find` | search/read your Geode vault (context, recipes, facts) | cheap | caller |
| `invoke` | run an **action** of an integration in your Geode vault; secret injected by the broker | medium | caller |
| `delegate` | hand an open-ended task to your Geode vault's agent to execute | expensive | vault |
| `remember` | save/update knowledge in your Geode vault (file a learning; integrated + committed) | medium | vault |
| `list_capabilities` | list what your Geode vault offers (recipes/skills + integrations & their actions) | cheap | — |

Default model: **the caller is the orchestrator; the vault is the recipe + the kitchen
equipment.** The caller `find`s a recipe and `invoke`s the vault's integration actions (using
your connections without ever seeing your secrets), reasoning for itself. `delegate` is the
fallback for weak callers (e.g. a limited ChatGPT integration) or full hand-off.

**Writing into context = `remember`, a distinct tool — not `delegate`.** Filing a learning well
(right place, dedup, cross-ref, update `index.md`/`log.md`, commit) is the karpathy *ingest*
operation — agentic, but it is its **own** tool for two reasons: (1) callers recognize "save
this" reliably from the MCP description, and (2) `delegate` stays focused on execution and fast.
`remember` may use a latency-optimized model (fast-ack, file in the background). There is **no
mandatory post-`delegate` auto-save reflex** (it would add latency); ambient auto-capture can be
an opt-in config later. `delegate` can still write as a *side effect* of a task; explicit
knowledge capture goes through `remember`.

Open mechanic for `invoke` (deferred): expose each integration's actions as their own MCP tools,
or one generic `invoke(integration, action, params)` + discovery (current lean: the latter, to
avoid tool-list bloat).

## 3. Distribution model (open-core)

- **Now:** an open-source, self-hostable kernel. Single-tenant per installation. No accounts,
  multi-tenancy, or billing.
- **Later:** a hosted service for businesses, with a local model option (data + model stay
  private). This is the commercial layer.

Design rule: build the single-tenant self-host kernel now, but make choices that do not
*preclude* the hosted future (HTTP-first transport, externalized config). Explicitly defer
multi-tenancy, accounts, per-user auth, and billing.

## 4. Decomposition & build order

1. **Kernel** — MCP server exposing `find` (cheap retrieval) + `delegate` (the
   agent-in-the-middle), over a git-backed workspace. The unproven magic; everything depends on
   it. *(Specced; build first.)*
2. **Context tools** — `remember` (ingest), the `list_capabilities` discovery tool, the
   autonomous reorganization ("lint"), and the event log.
3. **Secret broker** — secure secret storage + injection without ever exposing the value to the
   agent.
4. **Dashboard** — web UI (chat / file-tree + viewer / event-feed), realtime updates, git
   history. *(Core layout + realtime experience validated 2026-06-17; detail spec later.)*
5. **Integrations / repo installer** — install repos/tools (MCP servers, CLIs, API connections)
   needing OAuth/env/keys, with a link-back flow to add secrets, and the `invoke` surface.
   Depends on #3.
6. **Multi-workspace** — multiple workspaces with inheritance, optionally their own MCP
   endpoints. For self-host: folders within one vault rather than separate tenants.

Each sub-project gets its own spec → plan → implementation cycle.

## 5. Cross-cutting architecture

### 5.1 The vault

One git-backed directory that holds your context. Git is not only for versioning — it is the
**concurrency and safety mechanism**: each agent run is a commit; writes serialize; every state
is recoverable.

### 5.2 The constitution (two tiers)

1. **Immutable engine core** — the system prompt the kernel injects into every agent run,
   independent of workspace. Guarantees discipline: maintain a structured vault, follow the
   schema, update `index.md` + `log.md` after every change, never copy canonical facts, never
   put secrets in files.
2. **Evolvable per-workspace schema** — an `AGENTS.md` in the vault: folder map, domain-specific
   conventions, ID systems. Co-evolves with the user (karpathy-style).

### 5.3 Structural files

| File | Role | Maintained by |
|---|---|---|
| `AGENTS.md` | the schema: folder map + rules + IDs (RinDig "Layer 0") | agent + user |
| `index.md` | catalog: every page/asset with a one-line summary + link | agent, every change |
| `<folder>/CONTEXT.md` | what lives here, what to load, references upward | agent |
| `log.md` | append-only timeline, grep-able (`## [2026-06-17] …`) | agent, every action |
| `capabilities.md` | discovery manifest backing `list_capabilities` | agent |

### 5.4 Inheritance — "rules cascade, facts are canonical"

- **Rules / conventions** (tone-of-voice, naming, formats) **cascade** down the schema chain
  (`root → company → project`). Defined once high, apply everywhere below; deeper files do not
  restate them.
- **Facts / content** are **canonical**: they live in exactly one file and are *referenced* by
  link, never copied (RinDig's Canonical Sources pattern). Editing the canonical file updates
  everywhere at once.

### 5.5 Multi-workspace

Companies/projects are top-level workspace folders under a lean account-wide root:

```
vault/
├── AGENTS.md            # account-wide rules (apply to everything)
├── _shared/             # canonical sources genuinely shared across companies
├── acme-corp/           # workspace A: own AGENTS.md, own brand/voice (canonical within A)
└── globex/              # workspace B: own rules, no bleed from A
```

Multi-company is the same cascade, one level up. Isolation is a spectrum:

| Level | How | Good for |
|---|---|---|
| **Soft** | 1 vault, 1 endpoint; agent sees everything; scope is convention | your own projects |
| **Scoped** | 1 vault, 1 endpoint, `find`/`delegate`/etc. take a `workspace` param; agent confined to that folder | multiple clients, light confidentiality |
| **Hard** | 1 vault, but one endpoint + token per workspace; agent physically confined | agency / business clients |

**Decision:** start **soft** for dogfooding, but build the `workspace` parameter seam into the
tools from day one (cheap hook that enables scoped/hard later without breaking the interface).
Per-workspace endpoints then become config rows (vault path + workspace scope + token), not a new
system. Consequence: the secret broker must be **workspace-scoped** — a query on A can only
receive A's secrets.

### 5.6 Discovery

- **Rich discovery** (which files, what's in them) is *our agent's job* via the schema/index. The
  caller never needs the internals.
- **Lightweight capability manifest** (`capabilities.md` → `list_capabilities` tool) lets a caller
  decide *whether to route here at all* — e.g. "this vault has brand voice, content templates,
  integrations: Notion, Slack with their actions." Kept current by the agent.

### 5.7 Integrations

Live per workspace under `integrations/<name>/`, each with a manifest describing: what it does
(feeds `capabilities.md`), its **type** (`connection` for an authenticated external service,
`mcp-server`, `cli`, or `script`), how it is called, and which secrets it needs **by reference
name only** (`requires: [NOTION_TOKEN]`) — never the value. An integration exposes **actions**
(the MCP-native "tools"), called via `invoke`. "Connection" is therefore one *type* of
integration, not the umbrella term.

### 5.8 Secret broker — hiding requires a trust boundary

If the agent has full bash, env vars are readable (`printenv`, `/proc/<pid>/environ`). Injecting a
secret as an env var hides *nothing* while agent and secret share a shell.

True hiding requires a **trust boundary** between the agent and the secret — exactly the "own
workspace/container" from the original vision:

```
┌─ WORKSPACE CONTAINER (agent, unprivileged user) ─┐
│  agent ── "do Notion call" ──┐ socket, NO secret │
└──────────────────────────────┼──────────────────┘
                               ▼
              ┌─ SECRET BROKER (separate user / sidecar) ─┐
              │  holds NOTION_TOKEN; injects auth;        │
              │  forwards to API; returns only the result │
              └────────────────────────────────────────────┘
```

Two access modes:
- **APIs** → broker is a proxy that injects the auth header (strongest).
- **CLI tools** → broker spawns the tool as the privileged user with the secret in its env; agent
  receives only stdout.

The same isolation that makes running arbitrary agent code *safe* also delivers secret-hiding —
one architectural investment, two problems solved. **Decision:** design the broker properly from
the start (trust boundary + proxy/wrapper); build it later as #3. Integrations wait for it (no weak
env-var interim phase).

### 5.9 Auth flow — unified screen + signed capability link

Adding any credential (API key *or* OAuth) goes through one **auth screen** — the human-facing
front of the broker (#3 + dashboard #4):

```
1. Agent installs an integration, writes its manifest, declares "requires NOTION_TOKEN"
2. Agent returns a LINK → the dashboard auth screen
3. The human enters the key / completes OAuth → goes straight into the broker
4. Agent only ever knows "a secret named NOTION_TOKEN now exists" (a reference)
```

The link **never carries the secret — it requests one.** Properties: **signed** (HMAC/JWT,
unforgeable), **scoped** (workspace + secret-ref + provider), **short-lived** (minutes),
**single-use** (nonce). Transport over HTTPS; the entered value is stored **encrypted-at-rest** in
the broker. The link shines for agent-initiated / remote cases (e.g. a `delegate`/install from
ChatGPT needs a key it cannot handle). Workspace-scoped: A's link can only set A's secret.

### 5.10 Model-agnosticism (local + cloud, guaranteed)

The agent runtime never hardcodes a provider; it reads a **model-connector** config (base-URL,
auth, model-id, provider flags). Verified June 2026:
- **Local:** Ollama supports the Anthropic Messages API natively since v0.14.0 (no shim; set
  `OLLAMA_HOST=0.0.0.0:11434` in Docker). LM Studio / OpenAI-format via a LiteLLM shim.
- **Cloud:** Anthropic / Bedrock / Vertex native; GPT / Gemini / DeepSeek / Azure via LiteLLM's
  unified `/v1/messages` endpoint.
- Security note: avoid LiteLLM PyPI 1.82.7 / 1.82.8 (credential-stealing malware); pin a clean
  release.

### 5.11 Dashboard (core)

Validated as a three-zone web UI:
- **Top bar:** workspace switcher (left); event-feed + account (right).
- **Left:** chat with the vault agent (door B).
- **Right:** file tree + file viewer (text / code / pdf / images), side by side.

**Realtime experience** (the signature feature) — three coupled mechanisms:
- **A — live diff in the viewer:** the touched file auto-opens and shows the change as a git diff
  (added/removed) as it happens.
- **C — change-cards in the chat:** each agent action becomes a card ("file +4 −1 · view diff")
  that opens that diff in the viewer.
- **B (badges only) — tree status badges:** realtime "modified / new" badges across the tree. The
  literal "live typing" animation was dropped as redundant with the live diff.

Integration detail (open an integration): shows its manifest, the **actions** it exposes, and its
secrets **via the broker** (masked; API keys revealable/rotatable by the signed-in human; OAuth
shows status + reconnect, never the raw token). Installing a repo shows a "Setup required" state:
the agent's analysis, install/runtime steps, detected required env/secrets (add via the signed
link), running in the isolated workspace container.

Git underpins it: changes are uncommitted until committed (by the user or auto by the agent); the
git timeline is the history. Detailed component/interaction spec is its own sub-project. Visual
style (dark-first, emerald+blue on warm hue-165 near-black, 4-font split, **SVG icons, no emoji**)
is specified in `docs/design/geodemcp-visual-style.md`.

## 6. Deferred / open

- **Dashboard (#4)** core validated (see §5.11); the detailed component/interaction spec is its
  own sub-project later.
- Multi-tenancy, accounts, per-user auth, billing — deferred to the hosted layer.
- Hard isolation / per-workspace endpoints — built when the first client needs it.
- `invoke` action-exposure mechanic (per-action MCP tools vs generic `invoke`) — decide with #5.

## 7. Inspiration sources

- Karpathy, "LLM Wiki" — persistent compounding markdown wiki maintained by the LLM; schema +
  index + log; ingest/query/lint. https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- RinDig, "Content-Agent-Routing-Promptbase" — separation-of-concerns / layered routing; Canonical
  Sources pattern. https://github.com/RinDig/Content-Agent-Routing-Promptbase

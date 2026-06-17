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

Most MCP integrations expose a fixed list of tools. This product instead exposes **an agent that
sits next to your context**. A caller (Claude Code, Cursor, ChatGPT) asks in natural language; the
vault's agent reasons over your files, recipes, and SOPs and returns a synthesized answer or an
**executable plan**. It dissolves most of the "discovery" problem: the caller needn't know the
vault's internal structure — it expresses intent and the agent navigates.

**The boundary (decisive).** The vault is the **operator of your recipes and kitchen equipment** —
it gives context, looks things up, offers skills/SOPs, and explains *how* to use your tools. It
**does not execute external actions.** The **caller executes** (via `invoke`). So the vault is your
*specialized* context+tools layer, not a competing general agent — which keeps the value-prop intact
(the vault is the constant; the executing front-ends are swappable).

A powerful consequence: **the agent never touches secrets.** It only plans, which needs the
integration *manifest* (action + param shapes), never the credential. Secrets live only in the
broker and are injected server-side at the moment the **caller** calls `invoke`. "Hide secrets from
the agent" becomes trivial — the agent has no reason to hold them.

### 2.1 Operations

Five operations (each MCP description names the "Geode vault" so callers route intent reliably):

| Tool | What it does | Cost | Who works |
|---|---|---|---|
| `find` | direct, mechanical lookup of your vault — read a file / list a dir / search (grep · ls · cat). Raw content; the caller reasons. | cheap | caller |
| `delegate` | ask the vault to research/plan over your context + recipes; returns a synthesized answer **or an executable plan** (ordered steps + the exact `invoke` calls & values). **Does not execute external actions.** | expensive | vault agent |
| `invoke` | **the caller** runs one action of an integration; the broker injects the secret server-side and returns the result. | medium | caller |
| `remember` | save/update knowledge in the vault (ingest: integrated + committed). | medium | vault agent |
| `list_capabilities` | the menu: what the vault offers (recipes/skills + integrations & their actions). | cheap | — |

**Who does what.** `delegate` is the smart front door for *"how do I do X with my vault?"* — it
finds the steps + integrations and returns a ready-to-run plan; the **caller executes** that plan
with `invoke`. `find` and `invoke` are the caller's **direct shortcuts** (cheap lookup; run one
tool) for when it knows exactly what it wants. `list_capabilities` is discovery; `remember` is the
save-back. The vault agent operates only **within your vault** (read / organize / plan + bash to
inspect); it never calls integrations itself — that's the caller's job.

**Routing is a tuning knob (test on real cases).** With `find`/`list_capabilities` available, a
capable caller may try to do everything itself and skip `delegate`, missing your canonical,
synthesized knowledge. We bias the tool *descriptions* toward `delegate` as the default for "figure
out how to do X" and frame `find`/`invoke` as explicit shortcuts — but the caller is autonomous; we
steer, not force, and good DIY outcomes are fine. The optimal descriptions are empirical: tune via
dogfooding and observe which tools real callers pick.

**Writing into context = `remember`** (a distinct, recognizable tool). Filing a learning well
(right place, dedup, cross-ref, update `index.md`/`capabilities.md`/`log.md`, commit) is the
karpathy *ingest* operation. It reuses the vault agent but is its own tool so callers reliably pick
it for "save this".

Open mechanic for `invoke` (deferred): expose each integration's actions as their own MCP tools, or
one generic `invoke(integration, action, params)` + discovery (current lean: the latter, to avoid
tool-list bloat).

## 3. Distribution model (open-core)

- **Now:** an open-source, self-hostable kernel. Single-tenant per installation. No accounts,
  multi-tenancy, or billing.
- **Later (commercial):** a hosted SaaS — see §3.1.

Design rule: build the single-tenant self-host kernel now, but make choices that do not
*preclude* the hosted future (HTTP-first transport, externalized config, **Docker-packaged
kernel**, **per-instance token auth**). Explicitly defer multi-tenancy, accounts, per-user auth,
and billing.

### 3.1 SaaS / hosted track (the monetization path)

Subscription accounts where we manage the customer's runtime, with a **local-model option for
ultimate privacy** as a premium add-on (your context, your model, nothing leaves your
environment) — a strong wedge for businesses / regulated sectors.

Two principles keep this *additive*, not a rewrite:
- **Isolated instances × N, not shared multi-tenancy.** Each customer = their own isolated
  container running the same kernel + own vault + own MCP endpoint + own secrets. This is exactly
  our "hard isolation = endpoint + token per workspace" model (§5.5) and the secret-broker's
  container trust boundary (§5.8) — the SaaS isolation model is already designed.
- **Control plane / data plane split.** The kernel is the **data plane** (per-tenant runtime).
  The SaaS adds a thin **control plane**: accounts, billing, provisioning of instances, routing
  to the right tenant. The kernel stays clean; the SaaS is a layer on top.

Local model is already enabled by the model-connector seam (§5.10) — point a tenant runtime at a
local Ollama/vLLM or private cloud model.

**Honest cost:** the heavy/risky part is hosting arbitrary per-tenant code execution (the agent
runs bash, installs repos) — needs serious sandboxing, resource limits, egress control, abuse
prevention (cf. e2b / Daytona / Modal). Price for compute; lean on strong container/sandbox
isolation.

**Sequencing: kernel-first, NOT platform-first.** Build the kernel, dogfood, then the smallest
hosted offering = managed isolated kernel instances + a thin control plane. Cheap seams to
preserve now: Docker-packaged kernel, per-instance token auth, workspace scoping, broker
boundary.

## 4. Decomposition & build order

1. **Kernel** — MCP server exposing `find` (cheap retrieval) + `delegate` (the
   agent-in-the-middle), over a git-backed workspace. The unproven magic; everything depends on
   it. *(Specced; build first.)*
2. **Context tools** — `remember` (ingest) + `list_capabilities` + vault seeding/enriched
   constitution. *(Done + merged 2026-06-17; autonomous lint deferred.)*
3. **Secret broker + `invoke`** — encrypted secret store + server-side injection (the agent never
   sees secrets and never calls integrations), the caller-only `invoke` operation, and ONE sample
   integration. *(First cut; merges the core of #3 + #5.)*
4. **Dashboard** — web UI (chat / file-tree + viewer / event-feed), realtime updates, git
   history. *(Core layout + realtime experience validated 2026-06-17; detail spec later.)*
5. **Integrations installer** — the broader installer: OAuth flows, repo/CLI install, the signed
   auth-link, more integration types (the `invoke` surface + first sample integration land in #3).
   Depends on #3 + #4.
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

### 5.8 Secret broker

The vault agent never calls integrations (§2) — so **the agent never needs a secret.** Secrets are
used in exactly one place: when the **caller** calls `invoke`, the **kernel server** fetches the
secret from the broker, injects it into the outbound request, and returns only the result. The
caller gets data, never the credential; the agent isn't involved at all.

```
caller ── invoke(integration, action, params) ──▶ KERNEL SERVER
                                                    • broker.getSecret(ref)  (decrypt in memory)
                                                    • inject auth → call the integration's API
                                                    • return ONLY the response to the caller
```

**Store:** secrets live **outside the vault** (never in git), **encrypted-at-rest** (AES-256-GCM),
workspace-namespaced. Key from `GEODE_SECRETS_KEY`, or a generated `0600` key file on first run.

**Injection modes:**
- **API integrations** (first cut): the server injects auth (e.g. a header) into the outbound HTTP
  call. The secret only ever lives in the broker + that one request.
- **CLI tools** (later): the broker spawns the tool with the secret in the child's env, returning
  stdout. Weaker (a same-user agent could inspect `/proc`) — wants the OS/container boundary.

**Isolation, honestly.** Because the secret stays server-side and the agent is uninvolved, an
**in-server broker** suffices for the self-host first cut. A determined agent with full bash on the
same OS user could still read the store/key — best-effort now, hardened by the OS-user/container
boundary in the hosted layer (the same isolation that makes running arbitrary agent code safe).
**Decision:** build the store/injection cleanly now (in-server, caller-`invoke`); build the hard
boundary with the hosted layer.

> First-cut secrets are added via a **CLI** (no dashboard yet); the signed auth-link + unified auth
> screen (§5.9) land with the dashboard (#4).

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

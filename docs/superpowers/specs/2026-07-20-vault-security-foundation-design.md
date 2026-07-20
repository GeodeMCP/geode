# Vault Security Foundation — Design

**Date:** 2026-07-20
**Status:** Draft (design approved in brainstorm; pending spec review)
**Slice:** 1 of 4 in the hosted multi-vault program. This spec hardens a *single*
vault. Slices 2–4 (multi-vault hosting, backup & restore, client login) build on top
and are out of scope here.

## 0. Context: why this spec exists

The goal beyond this slice is to host many Geode vaults on one server (Fly.io first,
Mac later), each with its own MCP endpoint and dashboard, managed by one operator from
one login. Program decisions already locked in brainstorm:

- **Isolation runtime:** one OS **process per vault** (not a shared multi-tenant process,
  not a container per vault). Preserves macOS/Linux parity and keeps blast radius small.
- **Addressing:** subdomain per vault (`acme.geodemcp.com`), so each vault is its own
  origin and each browser tab is independent. Driven by: OAuth discovery works per the
  spec, cookie isolation, and multiple vaults open in multiple tabs at once.
- **Auth (v1):** operator-only. The supervisor authenticates; child processes trust a
  signed principal header from the proxy. Client login is slice 4.
- **API keys (v1):** one shared Anthropic key; per-vault override deferred.

**None of that is in this spec.** This spec answers a prior question: *is a single vault
safe enough to hold a client's files?* Today it is not. The rebuild multiplies whatever
one vault is, so one vault must be bulletproof first. Everything here is buildable and
testable on the operator's own local vault, with no hosting infrastructure.

## 1. Threat model & governing principle

The librarian must read external URLs and repositories and use what it reads to install
things into the vault. That is a hard functional requirement. It also means:

> **The agent processes hostile input by design.** An LLM that reads
> attacker-controlled text is an untrusted component. Prompt injection cannot be
> reliably prevented at the prompt layer.

So the design rule is not "prevent injection." It is:

> **Design so that a fully-compromised agent can still do nothing.**

From that, one invariant governs the whole spec. **Four things must never share one
execution context:**

1. hostile input (external URLs, repos, uploaded documents)
2. secret values
3. network egress
4. reach to other vaults

Any two of them together is an exfiltration path. Today all four live in one Node
process under one uid (`src/index.ts`, `src/query.ts`).

### 1.1 What is open today (verified against code, not docs)

These are the concrete holes this spec closes. Each is cited to source; where the
published docs disagree with the code, the code wins.

| # | Hole | Location |
|---|---|---|
| A | **Reads are unbounded.** The sandbox sets only `allowWrite`; `canUseTool` checks only `WRITE_TOOLS`. The agent has Bash and can read any path. On one shared volume, vault A reads vault B's secrets. | `src/agentSandbox.ts:85-87`, `:134-169` |
| B | **The secret key sits beside the ciphertext.** `loadOrCreateKey` writes `key` into the same dir as `secrets.enc` when no env key is set. Reading the dir yields both. | `src/secrets.ts:29-40` |
| C | **Agent egress is open on every platform.** The `WebFetch`/`WebSearch` deny was lifted so the librarian can read API docs. Functionally required, but an unbounded exfil channel. README still claims it is denied; it is not. | `src/agentSandbox.ts:141-143` |
| D | **`AGENTS.md` is agent-writable and loaded into every system prompt.** An injection that lands there persists into every subsequent run, every role. Not in `GENERATED_FILES`. | `src/overlay.ts:7-17`, `src/agentSandbox.ts:38` |
| E | **Manifest → credential exfiltration.** The agent authors `TOOL.md`. A manifest can point `http.url` at an attacker host with `${conn.KEY}` in a header. `http` invoke is unconfined in the kernel process. | `security-model.md:40`, `:48` |
| F | **Approval is not enforced at run time.** `installed.json` records approved permissions, but `sandboxRun.ts` reads the *live* manifest. Editing `TOOL.md` after approval takes effect with no re-consent. | `security-model.md:121-123` |
| G | **The dashboard install route has no consent step.** It passes `manifest.permissions` through as approved. The manifest approves itself. | `src/dashboard/api.ts:198` |

## 2. The design: four independent layers

The layers do not depend on each other for correctness. If one has a bug, the next still
holds. That independence is the point.

### Layer 1 — Two trust domains per vault

Split each vault into two OS processes under **two different uids**:

- **Broker** (trusted). Holds the secret store, executes `invoke`, performs git commits,
  serves MCP + HTTP + the dashboard. **Never reads hostile input.**
- **Agent-runner** (untrusted, **ephemeral per run**). Runs desk/librarian. No
  secrets directory readable by its uid; no Docker socket; filesystem view limited to the
  working tree of its own vault.

**This costs no functionality.** No agent role ever needs a secret *value*: the librarian
writes `${conn.X}` references, the desk prepares `invoke` calls, and the constitution
already forbids writing secret values. The split makes enforceable what the prompt
currently only promises (closes hole A, and B by putting the key out of the runner's uid).

Ephemeral per run: start → run → discard. Runs are already serialized per vault
(`src/runManager.ts`), so no runner state survives between runs except what was written
into the vault — which is in git and auditable.

**This is the largest change.** `query()` (`src/query.ts:84`) currently calls the Agent
SDK in-process with `cwd: vault.root`. It must instead run the agent in a separate,
privilege-dropped subprocess whose uid cannot read the broker's secrets or any other
vault's files. The broker↔runner boundary needs a narrow protocol: the broker hands the
runner a job (role, instruction, staged input dirs, the vault working tree) and receives
back the run's file mutations + transcript, then does the commit itself.

**Single-vault scope:** this spec establishes broker-uid ≠ runner-uid for one vault, and
that the runner cannot reach the Docker socket. Allocating a distinct uid pair *per vault
across many vaults*, and moving the Docker socket out to a supervisor, are slice 2.

### Layer 2 — Fetch and process are never the same context

The functional requirement (read external → install into vault) is made safe by splitting
retrieval from processing into two agent steps with opposite privileges:

- **Fetcher.** Network broadly open; **no vault, no secrets.** Fetches the URL/repo,
  distills what is relevant, writes it to a staging directory. An injection here has
  nothing to steal — what it fetched, the attacker already controls.
- **Librarian.** Vault write access; **network off.** Reads the staged distillate, writes
  `TOOL.md` / vault pages. Builds on the existing attachment-staging mechanism
  (`extraReadDirs` read-only grants, `src/query.ts:124`).

This yields **three egress tiers**, and egress is closed exactly where it is dangerous:

| Context | Network | Secrets | Vault | Rationale |
|---|---|---|---|---|
| Fetcher | broad | none | none | nothing sensitive to exfiltrate |
| Librarian | **none** | none | write | holds the vault open, so no outbound channel |
| Invoke (broker) | per-tool approved hosts only | yes (injected) | — | the only credentialed path |

**Cost, stated honestly:** two agent invocations instead of one — more latency, more
tokens — and the fetcher must decide what to distill.

### Layer 3 — Installing is a decision of the trusted side

The agent *proposes*, the human *decides*, the broker *enforces*. This is what the
constitution already says ("may author but never install `TOOL.md`"); this layer makes it
an architectural boundary instead of a prompt promise.

- **Declared hosts vs approved hosts — the load-bearing split.** The manifest is
  agent-authored and in git, so the approved set can NEVER live there or the agent approves
  its own hosts. Two separate records:
  - **Declared** (the *request*): the tool's `permissions.network` frontmatter field lists
    the hosts it wants to reach. Agent-authored, git-tracked, versioned — you can see in
    history what a tool ever asked for. This is a declaration, never a grant.
  - **Approved** (the *grant*): the human-blessed set, stored on the **trusted side outside
    the vault**, beside `installed.json` in `~/.geode/tools/<id>/`. Not agent-writable, not
    in git.
  The broker **enforces against the approved set, never the live manifest.** At invoke it
  extracts the target host (from `http.url`; for a `cli` tool, the container's egress) and
  refuses anything not approved *for that tool* — including `http`, unconfined in the kernel
  process today (closes E). Per-tool, not per-vault (rationale in §4).
- **Manifest hashing binds the two.** The approval record stores a hash of the declared
  manifest. Any manifest edit changes the hash and invalidates approval → re-approval
  required. Closes F: today `installed.json` stays valid after an edit and the runtime reads
  the *live* manifest.
- **Approval card in chat.** Runs are non-interactive — `AskUserQuestion` stays disabled
  (`src/engine.ts`), so the agent cannot block mid-run for approval. The run ends having
  written its declared hosts and recorded them as *pending* against the trusted record; the
  dashboard chat renders an approval card ("this tool wants to reach `api.moneybird.nl`,
  with this credential — approve?"). Approving is a broker action moving pending→approved,
  not an agent tool. Same out-of-band-human-action pattern as the existing secret links
  (`security-model.md:168-172`).
- **Host management — three existing surfaces, no new navigation.** Each maps to an
  existing component (grounding UI consistency, see §8):
  - **Manage → `ToolPanel`** (`web/src/components/ToolPanel.tsx`), the live per-tool panel
    that already carries "install & trust" and "connections". Hosts become a sibling section
    there: approved + pending, with **add / revoke**. Source of truth. The operator can
    pre-approve a host with no run proposing it; revoking makes the next invoke to that host
    fail, no silent continuation.
  - **Discover globally → `NeedsAttention`** (`web/src/components/NeedsAttention.tsx`), the
    bell + drawer that already aggregates uncommitted changes, unconfigured connections, and
    backlog gaps with a count badge. A **pending host approval becomes a new attention
    category** — findable without knowing which tool; each item links into that tool's panel.
  - **Approve just-in-time → the chat card** in `Chat` (`web/src/components/Chat.tsx`).
  All three write the same trusted approval record; the manifest is never mutated by approval.
- **Dashboard consent parity.** The dashboard install route gains the same consent gate the
  CLI already has (closes G).
- **Docker socket outside the agent-runner.** Only the broker builds/runs containers; the
  runner uid cannot reach the socket. (Moving the socket further out to a supervisor is
  slice 2.)

### Layer 4 — The file that steers the prompt is not agent-writable

`AGENTS.md` is loaded into the system prompt on every run (`src/overlay.ts:7-17`) and is
not protected, so the agent can write its own steering file and persist an injection across
all future runs (closes D). Fix: `AGENTS.md` is editable only via the dashboard, never by
the agent — the same treatment `index.md` and `.geode/graph.json` already get in
`GENERATED_FILES` (`src/agentSandbox.ts:38`).

## 3. Verification (a foundation is proven, not assumed)

- Run `scripts/verify-sandbox.ts` on the Linux image (per `SOP/verify-sandbox.md`).
- **Adversarial test:** a compromised runner uid cannot read the broker's secret store or a
  second vault's directory.
- **Egress test:** a librarian run has no outbound network; a fetcher run has no vault/secret
  access; an invoke to a non-approved host is refused.
- **Persistence test:** the agent cannot write `AGENTS.md`; a manifest edit invalidates its
  prior approval; the dashboard install path requires consent.

Each closed hole in §1.1 gets a regression test named for its row (A–G).

## 4. Decision rationale: per-tool vs per-vault host approval

The credential is already scoped per tool at invoke — the broker resolves only that tool's
`requires` connections, so tool X's call never carries tool Y's secret. The host allowlist's
job is to pin *where* that credential may go.

- **Per-vault** (one shared allowlist / union): the safety of every credential is only as
  strong as the *weakest approved host in the whole vault*. Approve one host where an
  attacker can observe inbound requests (their own SaaS account, a webhook, a paste service)
  and it becomes a drain for every credential.
- **Per-tool:** each credential can only ever reach its own tool's approved hosts. A new
  tool with a dubious host never weakens existing credentials.

Honest counter: Layer 3's manifest-hashing already catches much of the per-vault risk
(changing a manifest's host re-triggers approval and surfaces the odd host). Per-tool is
chosen anyway because it makes "this credential may only go here" an invariant that does
**not** rely on the operator reading every diff carefully or on the hash check being
bug-free — consistent with the independent-layers philosophy of the whole design. The cost
is small: a host shared by two tools is blessed twice, which is arguably the correct
boundary (two separate trust decisions).

## 5. Scope boundary (what this spec does NOT do)

- No supervisor, no host-based routing, no vault-CRUD, no per-vault uid *allocation* across
  many vaults, no signed principal header, no `.geodemcp.com` cookie — **slice 2**.
- No backup/restore mechanism — **slice 3**. (One dependency lands early elsewhere: the
  git remote is configured at vault-creation time, in slice 2's creation flow, not here.)
- No multi-principal accounts, ownership, grants, or client login — **slice 4** (issue #38).
- The secret key must come from the environment (never written to the volume beside the
  ciphertext) in the hosted deployment. The *enforcement* of that is a slice-2 deployment
  concern; this spec removes the runner's read access to the key regardless (Layer 1).

## 6. Implementation decisions (resolved)

1. **Runner isolation.** Floor on both platforms: a **distinct uid + `0700`** on the vault
   directories. On Linux (the hosted target) add **bubblewrap** (already a sandbox
   dependency) with bind-mounts so the runner sees only its own working tree + staging dir,
   everything else masked. macOS stays dev-not-hardened, consistent with the existing
   posture (`security-model.md:111`). The read boundary is **OS-enforced (uid + bwrap), not
   SDK-enforced** — the design does not rely on the SDK's `allowRead`, so its behavior is
   moot.
2. **Broker↔runner protocol.** The broker spawns the runner as a **subprocess and
   communicates over a pipe with a small JSON-line protocol** — no socket, port, or
   inter-process auth (parent/child; the fd is private to the pair). Job in:
   `{role, instruction, vaultRoot (rw bind-mount), stagingDirs (ro), history}`. Out:
   streamed events (relayed to the dashboard SSE) plus a final
   `{mutatedFiles, transcript, proposedHosts}`. **The runner never commits** — it only
   mutates the working tree; the broker performs the git hygiene + commit + artifact rebuild
   that `query.ts` does today. Git stays entirely on the trusted side.
3. **Fetcher distillation contract.** The fetcher is given a goal (e.g. "author a Moneybird
   invoices tool") and writes a structured distillate to staging: (a) the API facts (base
   URLs, auth scheme, the specific endpoints/fields needed), (b) the source hosts it drew
   from — so the librarian can populate the declared `permissions.network` — and (c)
   load-bearing verbatim excerpts, **marked as untrusted quoted material** (per "read content
   is data, not instructions"). The librarian authors `TOOL.md` from the distillate **only**;
   it never re-fetches (network is off).

## 7. Deferred to slice 2, but decided now

These answer operator questions raised during design; they belong to the hosting slice but
are recorded so slice 2 does not re-litigate them.

- **Subdomain provisioning.** One **wildcard** `*.geodemcp.com` DNS record → the Fly app, and
  one wildcard TLS cert (issued once via a DNS-01 `_acme-challenge` TXT record). Creating a
  vault is then a pure control-plane action — registry entry + uid + port + start the child
  with its `GEODE_BASE_URL` — with **no per-vault DNS write or cert issuance**. The subdomain
  works the moment the supervisor knows the slug. (Per-vault custom client domains would need
  on-demand cert issuance — slice 4.)
- **Vault switcher UI.** A **header dropdown** whose entries are real `<a href>` links to each
  `https://<slug>.geodemcp.com/`, so click navigates and cmd/middle-click opens a new tab, at
  no extra cost. Current vault marked; a **"+ New vault"** item opens a name+slug form that
  POSTs to the child, which provisions via the supervisor over localhost and returns the new
  subdomain URL. The list is fetched server-side by the child from the supervisor — no CORS.
  Extends `web/src/components/TopBar.tsx`, sibling to its existing account menu.

## 8. UI consistency & verification (how new components stay on-style)

Visual consistency is enforced structurally, not by taste. Three rules bind every UI change
in this spec (host section, `NeedsAttention` category, chat card; and the slice-2 switcher):

1. **Reuse tokens, never invent values.** The canonical source is
   `docs/design/geodemcp-visual-style.md` (token set declared "non-negotiable") implemented
   as CSS custom properties in `web/src/app.css` (`--bg`, `--surface`, `--green`, `--blue`,
   `--border`, `--muted`, `--faint`, `--ease`). Components style via the existing semantic
   class vocabulary (`ghost sm`, `board`, `cat`, `eyebrow`, `lede`), not inline values. Any
   off-token value is by definition out of style.
2. **Model each new component on an existing precedent.** Host management → `Secrets.tsx`
   (the grouped `board → cat → conn` management pattern with ghost buttons and search).
   Switcher → `TopBar.tsx`'s account menu. The genuinely-new element is the **chat approval
   card**; it has no precedent, so it is **mocked first** (via the frontend-design skill, into
   `docs/design/mockups/`) and **approved by the operator before it is built** — not guessed.
3. **Verify against the running dashboard, not just the tests.** "Done" for any UI piece
   means it has been viewed in the live dashboard (browser screenshot against the running
   kernel) and sits beside the existing UI without reading as pasted-in — in addition to the
   per-component `*.test.tsx` that every component already carries.

The implementation plan turns these into explicit steps with a review checkpoint per
component: identify precedent → reuse tokens/classes → (if new) mock and get sign-off →
verify in the running UI.

# Vault Workshop: Onboarding & Capability-Gap Backlog — Design

**Date:** 2026-07-03
**Status:** Draft (design approved in brainstorm; pending spec review)

## 1. Goal

Make the dashboard vault-chat a **workshop**: the owner drops a workspace folder
(file(s) / folder / zip) into the chat, and the agent guides them through turning it
into first-class vault content — **tools** (`TOOL.md`), **skills/recipes**, and
**context/SOPs** — following Geode principles, including credential setup captured
*outside* the agent.

First concrete target: migrate the existing `administratie` bookkeeping workspace
(`~/Darcel/administratie`): a Moneybird REST wrapper (`bin/mb-api`), a Gmail fetcher
(`bin/gmail-fetch`), three Claude skills (`moneybird-booking`, `gmail-invoice-search`,
`moneybird-contact-mgmt`), and a body of reference knowledge.

Secondary goal: a **capability-gap backlog** so that whenever any run surfaces something
missing, the vault records it as a "to be developed" item instead of failing silently.

## 2. The surface model (locked decision)

There are two kinds of surface, and they must stay separated:

| Surface | Purpose | Character |
|---|---|---|
| **Vault-chat (dashboard)** | *Build & maintain* systems — tools, skills, structure, secrets, OAuth guidance | Rich, interactive, multi-turn, attachments, full write-agency |
| **`query` (MCP)** | Daily *retrieval* — find context + the plan | Thin, read/plan (may write one gap entry) |
| **`remember` (MCP)** | Daily *storage* — one distilled note | Thin, one-shot |
| **`invoke` (MCP)** | Daily *execution* — one tool action; caller executes, secret injected server-side | Thin, deterministic |
| **`list_capabilities` (MCP)** | Daily *discovery* — what the vault can do, plus what it still needs | Thin, read-only |

**Rationale.** No MCP door authors vault structure: `query` reads/plans, `remember` files a
single note, `invoke` only runs a tool that already exists. Setting a system up — authoring
`TOOL.md`, writing skills, structuring folders, wiring secrets, guiding OAuth — requires full
write-agency plus uploads, an approval loop, secret-capture and connection-testing. That
combination lives only in the dashboard. Therefore: **the workshop is the dashboard; the MCP
tools are the thin daily doors to what was built there.** `query`/`remember` stay deliberately
thin; setup complexity belongs in the workshop.

The underlying agent can technically write from any run (a `query` auto-commits edits), but the
*designed, supported* place to set up a system is the vault-chat.

## 3. The journey

```
drop folder
  → stage it OUTSIDE the vault (temp dir)
  → agent inspects the staging dir (read-only grant), NOT the vault
  → classifies contents: knowledge | skills | tools
  → proposes a filing plan + the secrets it will need
  → STOP (ends its turn with the proposal + a question)
  → owner approves; pastes tokens via capture link; tests the connection
  → agent writes pages / skills / tools per OKF + constitution
  → anything not yet fleshed out is recorded as a backlog gap
```

The "STOP → approve → continue" step is a normal multi-turn exchange, not a mid-run prompt.
`AskUserQuestion` stays denied (the MCP non-interactivity rule holds); the agent pauses by
ending its turn.

## 4. Components (workstreams)

### WS1 — Attachment intake  *(BUILD; the sandbox seam already exists)*

- **Composer upload affordance** in `web/src/components/Chat.tsx`: file / multi-file / folder /
  zip, with a chip listing staged items. Sits beside the existing text input.
- **`POST /api/uploads`** (new, in `src/dashboard/api.ts` + mount in `src/server.ts`): a multipart
  parser (busboy) → unzip → stage to a per-session temp dir *outside* the vault → return
  `{ uploadId }`. Today only `express.json` is mounted, so this is the one new piece of transport.
- **Thread the upload into the run:** `/api/query` gains an optional `uploadId`; it resolves to the
  staging dir and passes it as `extraReadDirs` into `buildSandboxSettings`. The seam is already
  present and tested — `src/agentSandbox.ts:72` accepts `extraReadDirs` and emits
  `filesystem.allowRead`; today `src/query.ts:80` passes nothing. `query()` / `runQuery` signatures
  gain an optional attachment-dirs argument.
- **Lifecycle:** remove the staging dir after the run (or on session end).

**Boundary honored:** the agent gets *read* access to the staging dir only; write is still confined
to the vault by the sandbox.

### WS2 — Conversation continuity  *(BUILD — the one non-trivial new piece)*

Today each chat turn is a cold run: `/api/query` passes only `instruction`
(`src/dashboard/api.ts:99`), and transcripts are persisted (`src/transcripts.ts`) but never read
back. The propose→approve→continue loop needs the follow-up turn to carry context.

- Feed the last N transcript turns of the current session into the run (as prior context in the
  instruction or system prompt). Persistence already exists; only read-back is missing.
- Keep it minimal: recent turns, not full history. Bound N.

**Open question (see §8):** thread recent transcript vs. have the agent persist a short
"pending proposal" note the next turn reads. Lean: transcript-threading — no new file type,
reuses what's persisted.

### WS3 — In-context secret capture + test  *(mostly UI glue; infra EXISTS)*

Option A (dashboard secret-capture) is largely pre-built:
- Secret store has `set`; `listSecrets` exists.
- A **capture link** exists: `POST /api/secrets/:ref/link` mints `/auth/s/<token>`, an entry page
  where the value is typed *outside* the agent and stored by ref (`connRef = tool__label__key`).
- "Needs setup" detection exists: `connectionConfigured` / `deriveCapabilities`
  (`src/tools.ts:100`, `src/capabilities.ts`).
- A per-connection **test endpoint** exists: `POST /api/tools/:id/test` runs one `invoke`
  server-side (`src/dashboard/api.ts:168`).

Build:
- After a run authors/updates a `TOOL.md`, surface its unconfigured connections **inline in the
  chat flow** with a "set secret" action that mints the existing capture link — not buried in a
  separate Secrets tab.
- A "test connection" button wired to `/api/tools/:id/test` (e.g. Moneybird
  `GET administrations.json`) → green check during setup.

**No new secret-transport protocol.** The agent declares `requires` in the manifest; capture +
verification flow through existing out-of-agent infrastructure. The agent never sees a value.

### WS4 — The `onboard-workspace` skill  *(BUILD — the brain; core prompt work)*

A new kernel skill (sibling to `kernel-skills/onboard-tool.md`). Given a staging dir, it:

1. **Inspects** the folder.
2. **Classifies** contents into:
   - **knowledge** — `reference/*.md`, docs, config notes → OKF pages in the vault;
   - **skills** — `.claude/skills/*/SKILL.md` → vault recipes (`type: skill`), rewriting
     `./bin/mb-api …` → `invoke(moneybird, …)`, local file paths → vault pages, and adapting
     confirm-batch to the turn-based approval model;
   - **tools** — credentialed wrappers under `bin/*` → `tools/<id>/TOOL.md` with one connection per
     real account (for Moneybird: `roverm`, `mijnwebontwikkelaar`) and named actions.
3. **Proposes** the plan and **stops** for approval.
4. On approval, **writes** everything per OKF + the constitution: maintain `index.md`, append to
   `log.md`, dedup, cross-reference, and never put secret values in files.

**Tool-authoring guidance for the CLI-REST-with-connections shape** (extend `onboard-tool.md` or
add an example): per-account → connections; REST verbs → named `http` actions with templated JSON
bodies; secret keys → `requires`.

### WS5 — Deterministic response envelope  *(BUILD — small, shared foundation)*

Fold a deterministic outcome line into the *visible* text of `remember`/`query` responses, e.g.
`✓ filed to notes/x.md (+2 cross-refs), commit d75482e`. The facts (commit, filesTouched) are
already computed (`src/query.ts:90-91`) but only land in `structuredContent`, which clients render
inconsistently — a live `query` in testing returned only `{commit:null, filesTouched:[]}` with no
visible answer. Construct the line in `src/server.ts` / surface via `src/query.ts`.

Most impactful for the MCP side; also sharpens the dashboard's closing summary.

### WS6 — Capability-gap backlog  *(BUILD — the connective tissue)*

When any run references or needs a capability that does not exist yet, the agent records a **gap**
in the vault instead of failing silently or hallucinating. Daily use *discovers* gaps; the
workshop *resolves* them.

**Shape:** one OKF page per gap under `backlog/<slug>.md`:

```yaml
---
type: gap
kind: tool            # tool | context | sop | skill
title: Moneybird REST tool
status: needed        # needed | drafting | done (done → page removed)
surfaced_by: "query: 'boek q1 voor mijnwebontwikkelaar' (2026-07-03)"
---
What is missing and why it is needed.

## Still to work out
- connections: roverm, mijnwebontwikkelaar (per-admin token)
- actions: list_mutations, create_purchase_invoice, attach_pdf (multipart!),
  link_booking, unlink_booking
- open: multipart upload not yet supported by the http executor
```

**Behavior:**
- The agent writes a gap when it detects a missing referenced capability (constitution/skill rule),
  with dedup against existing gaps (same discipline as `remember`).
- Gaps surface in `list_capabilities` under a new `## Planned / needed` section
  (extend `deriveCapabilities` / `src/capabilities.ts` to scan `type: gap`), and in `index.md`.
- A tool-gap may carry a **draft** (a sketch `TOOL.md` in its body) that gets promoted when built.
- **Resolution:** when the real tool/skill/SOP is authored in the workshop, the agent removes (or
  marks `done` and prunes) the matching gap.
- This makes a "can't do it yet" `query` clear: *"tool X is missing — logged to
  `backlog/moneybird-tool.md`; set it up in the dashboard?"*

## 5. Scoping decisions

1. **Multipart PDF-attach — IN.** Extend the `http` executor to support a file/multipart param
   (`src/invoke.ts:39-40` currently sends a string body only). Attaching a receipt PDF is core to
   bookkeeping; the alternative leaves one step manual and the loop not hands-off. Small (~half day).
2. **Gmail — LOCAL for v1.** `gmail-fetch` (gogcli OAuth + browser + localhost callback) does not
   containerize cleanly. The agent *guides* its OAuth setup and the owner runs it locally to drop
   PDFs into the chat. Geode owns Moneybird (tokens, booking, learned mappings). Gmail-as-a-Geode-
   tool is a later wave; the full hosted OAuth broker is the parked SaaS play.

## 6. Non-goals (explicitly out of scope for this spec)

- **Dashboard-native *execution* of bookings.** The vault agent plans; it does not execute `invoke`
  (`src/constitution.ts:8`). Running a booking end-to-end happens from an external caller
  (Claude Code) via `query` (get the plan) + `invoke` (execute). Dashboard-native execution is a
  later capability (needs a caller-loop) — this spec is about *setting the system up*, which is pure
  vault-writing and does not hit that wall.
- **Full hosted OAuth broker** — parked SaaS.
- **Gmail as a Geode tool** — later wave.

## 7. Data shapes / interfaces touched

- `POST /api/uploads` → `{ uploadId }`; staging dir keyed by session + uploadId, outside the vault.
- `POST /api/query` body: `{ instruction, uploadId? }`.
- `query()` / `runQuery`: optional `attachmentDirs: string[]` → `buildSandboxSettings(policy, dirs)`.
- `http` action: add optional multipart/file param support in `ToolAction.http` + `src/invoke.ts`.
- Gap page: `type: gap`, `kind`, `status`, `surfaced_by` frontmatter under `backlog/`.
- `deriveCapabilities`: add a `Planned / needed` section from `type: gap` pages.

## 8. Risks & open questions

- **Continuity approach** (WS2): transcript-threading vs. a persisted "pending proposal" note.
  Lean transcript-threading. Decide in the plan.
- **Multipart security:** the file param resolves to a path in the staging dir (read-granted); must
  not allow arbitrary host paths. Constrain to staging/vault roots.
- **Gap dedup quality:** the agent must not spawn duplicate gaps; relies on the same LLM dedup
  discipline as `remember`. Mitigate with a clear skill rule + `surfaced_by` provenance.
- **Skill translation fidelity** (WS4): the `moneybird-booking` skill encodes a confirm-batch and a
  self-healing link/unlink race; the translated vault recipe must preserve that behavior under the
  turn-based model.

## 9. Success criteria

End-to-end milestone: drop the `administratie` folder into the dashboard chat →
1. the agent proposes a plan and stops;
2. on approval it creates `tools/moneybird/TOOL.md` (two connections), the booking/reference vault
   pages, and the migrated skill(s);
3. the two Moneybird tokens are set via capture link and **test green** in-chat;
4. at least one gap is recorded (e.g. `backlog/gmail-tool.md`) and shows under
   `list_capabilities` → Planned / needed;
5. from Claude Code, `query("how do I book a mutation for mijnwebontwikkelaar")` returns the SOP +
   the exact `invoke` plan, and one real booking runs via `invoke` (including the PDF attach).

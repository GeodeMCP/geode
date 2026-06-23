# Draft-Commit Flow — Design

**Status:** approved in conversation, pending spec review
**Date:** 2026-06-23
**Decision record:** memory `commit-concurrency-model`

## Problem

Today the dashboard runs the agent in review-mode (`commit:false`) but **forces** the human to Commit or Discard before the next message — the chat composer is locked while the tree is dirty. That breaks conversational, multi-turn editing ("draft a note" → "expand section 2" → "fix the title"). The lock exists only because `query.ts` resets the working tree at the start of every run, so a follow-up run would otherwise wipe the un-reviewed draft.

We also want to start letting MCP write to the same vault. MCP has no human reviewer, so it auto-commits (already the case) — but on a shared single working tree an MCP run would `resetToHead()` and destroy a pending dashboard draft.

## Decisions (locked — see memory `commit-concurrency-model`)

1. **MCP writes auto-commit** (unchanged): no human on that channel → commit-on-success, return the hash.
2. **Dashboard is human-commit, accumulate-then-commit**: chat keeps flowing across turns; changes pile into one reviewable changeset; the human commits when satisfied (or discards). The dirty banner is informational, not an input-lock.
3. **Review-mode runs never auto-reset**: not at start, not on failure. The human's **Discard is the only reset**. A failed review-mode run leaves its partial edits on the tree for the human to inspect/keep/discard.
4. **MCP write on a dirty tree = checkpoint, not wipe**: when an auto-commit run starts and the tree is dirty (a human draft is pending), it commits that draft first as a checkpoint, then proceeds — MCP never destroys in-progress review.

**Deferred (NOT in scope):** per-run git-worktree isolation for real concurrency/multi-user — lands with #6. Commit provenance prefixes and feeding MCP runs into the transcript store — separate cheap wins, not now.

## Behavior change, precisely

`query.ts` currently, at run start:
```ts
if (!(await deps.workspace.isClean())) await deps.workspace.resetToHead();
```
and, in the `catch`, `await deps.workspace.resetToHead()` on any failure.

New, mode-aware (mode = `opts.commit === false` → review; else auto-commit):

- **Start of run:**
  - **Review mode:** do nothing — accumulate on top of whatever is in the tree (prior agent draft and/or manual Viewer edits).
  - **Auto-commit mode (MCP):** if the tree is dirty, **commit the pending changes as a checkpoint** (`dashboard-draft: checkpoint before <runId>`), NOT reset. If clean, proceed as today.
- **On failure (`catch`):**
  - **Review mode:** do NOT reset. Leave the working tree as-is; still log the error to the event log? No — review-mode already skips the event-log/commit path (it returns before it). So on failure: just rethrow; the partial edits remain for the human. (No `resetToHead`.)
  - **Auto-commit mode:** unchanged — `resetToHead()`, log error, rethrow.
- **On success:**
  - **Review mode:** unchanged — return `{commit:null, filesTouched: uncommittedChanges()}`.
  - **Auto-commit mode:** unchanged — `commitAll`, log, return commit.

### Why review-mode failure leaves the tree (not reset)

In review mode the human is the reviewer and the **Discard button already maps to `resetToHead`**. Auto-resetting on failure would also wipe the *accumulated* prior draft (everything since the last commit), not just this run's partial work — a worse outcome than leaving the partial edits visible. So: leave it, surface the error in chat, let the human decide. This keeps the change small (no per-run snapshot/stash machinery).

## Components touched

| File | Change |
|------|--------|
| `src/query.ts` | mode-aware start (review: no reset; auto-commit: checkpoint-if-dirty instead of reset) + mode-aware failure (review: no reset) |
| `src/workspace.ts` | (only if needed) a helper to commit pending changes as a checkpoint — likely reuse existing `commitAll` |
| `web/src/components/Chat.tsx` | composer no longer disabled while `dirty`; drop the dirty submit-guard and the "Commit or discard first" placeholder; dirty banner stays as an informational bar |
| `web/src/views/VaultHome.tsx` | (check) it passes `dirty` into `Chat`; the banner/commit/discard wiring stays — only the input-lock goes |

No API/SSE/contract changes. No new config.

## Edge cases

- **Manual Viewer edits + agent runs accumulate together** — both are just working-tree changes; the human commits the lot. Already consistent with this model.
- **Browser closed mid-draft** — the uncommitted changes simply stay in the working tree; on next dashboard load the dirty banner shows them, the human commits/discards. (Acceptable; no extra handling.)
- **MCP run while dashboard has a draft** — checkpoint-commits the draft first (rule 4). The human's draft becomes a real commit under a `dashboard-draft:` message; they keep their work, just committed earlier than they'd have chosen. Rare for a solo user; lossless.
- **Failed review-mode run after several good turns** — partial edits of the failed turn sit on top of the good accumulated draft; the human can Discard everything or manually clean up. The diff viewer shows the full picture.

## Testing

- `test/query.test.ts`:
  - review mode + dirty tree at start → **no reset** (a pre-seeded uncommitted change survives the run and is included in `filesTouched`).
  - review mode + engine throws → working tree is **not** reset (partial change remains); error still rethrown.
  - auto-commit mode + dirty tree at start → the pending change is **committed as a checkpoint** before the run (assert a checkpoint commit happened), not discarded.
  - auto-commit mode failure path → still resets (unchanged) — keep/confirm existing test.
- Web: existing Chat tests stay green; (optional) assert the composer is enabled when `dirty` is true.

## Live validation

Restart the demo kernel; in the dashboard: run a query, then send a **follow-up** message without committing → confirm it builds on the prior draft (not wiped) and the composer was never locked. Commit once → one changeset lands. Discard → tree returns to HEAD.

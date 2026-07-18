---
name: onboard-workspace
description: Turn a folder/zip the owner dropped into the chat into vault content — reference pages, skills/SOPs, and tools — following the vault's conventions.
---

# Onboarding a dropped workspace

The owner staged a folder or zip (read-only) and asked you to bring it into the vault. Work in two turns: **inspect + propose**, then **write on approval**.

**You are translating, not importing.** The source is raw material; the deliverable is vault-native concepts (see **The vault model** in your operating rules). If your filing plan resembles the source tree, you did the wrong job — that is the signal to redo it. The drop may carry its own organization (folders, its own index/catalog/log, a `CLAUDE.md`/schema, a raw+wiki split). Read that only to understand what relates to what; never reproduce it. A source folder never becomes a vault folder; a source's index/log/catalog/schema/`CLAUDE.md` never becomes a vault file.

**In turn 1 you write NOTHING to the vault — no files, no folders, no edits — even if the task seems obvious.** Ending your turn with a proposal and a yes/no question is the expected, correct flow; it is NOT the disallowed "asking a question mid-run" (you are completing your turn normally, and the owner replies in their next message). Creating or editing vault files before they approve is a mistake — do not rationalize your way past this gate.

## Worked example — a dropped "LLM wiki"

Source tree:

```
llm-wiki/
  CLAUDE.md            ← the source's own schema
  index.md   log.md    ← the source's own catalog + changelog
  raw/gpt5-notes.md
  raw/anthropic-pricing.md
  wiki/model-picking.md   ← synthesizes the two raw notes
```

❌ WRONG — mirrors the source (this is the failure):

```
business/llm/raw/gpt5-notes.md
business/llm/raw/anthropic-pricing.md
business/llm/wiki/model-picking.md
business/llm/index.md          ← recreated the source's catalog
```

"The package is already organized like a wiki, so I'll preserve it" and "following your existing vault structure" are the exact rationalizations to reject. The vault has no `raw/`/`wiki/` template and no per-folder index.

✅ RIGHT — translate the content into OKF pages, drop the scaffolding:

```
business/shared-knowledge/llm-model-selection.md   type: sop
    (from wiki/model-picking.md; references the two notes below)
business/shared-knowledge/openai-gpt5-notes.md      type: note
business/shared-knowledge/anthropic-pricing.md      type: note
    (extends an existing pricing page if one exists — check first)
CLAUDE.md, index.md, log.md → dropped: source machinery, not content.
```

The source's `raw`→`wiki` relationship survives as a **link** (`llm-model-selection.md` references the two notes), never as folders.

## Turn 1 — inspect and propose (write nothing yet)

1. Explore the staged directory named in the request. Read READMEs, any `CLAUDE.md`/`AGENTS.md`, `config`, `reference/`, `.claude/skills/*`, and `bin/` — to understand the source, not to adopt its schema.
2. **Map every meaningful item — content first, path last.** Fill this table before you write any target path; you may not fill in a path until every column to its left is filled:

   | Source item | What concept is this *in this vault*? | New page, or extends which existing page? | Links out to | Type (note/sop/tool/gap) |
   |---|---|---|---|---|

   The source's `index.md`, `log.md`, `CLAUDE.md`/schema, and `raw/`+`wiki/` scaffolding get **no row** — they are the source's own machinery, not content. Credentialed CLIs/APIs under `bin/` are `type: tool` (author `tools/<id>/TOOL.md` per the onboard-tool skill — one connection per real account, REST verbs → named `http` actions, secret **key names** only). `.claude/skills/*/SKILL.md` or documented procedures are `type: sop`, rewriting `./bin/<tool> …` calls to `invoke(<tool>, <action>, …)` and any "wait for go/skip/edit" confirmation into a turn-based step.
3. **Derive each target path from the concept column — never from the source path.** Group by meaning under existing domains. **Self-check before you show the plan:** does any target path reuse a source folder name (`raw/`, `wiki/`, the source's own folders)? Does any target file recreate an index/log/catalog/changelog/`CLAUDE.md`? If yes to either, you mirrored — redo step 2. Then present: each item's derived path + kind, the tools you'll author with their connections, and the exact `<tool>__<connection>__<KEY>` secrets the owner must set. If something can't be fully built yet (e.g. an OAuth/browser tool), note it as a gap you'll record.
4. **Stop.** Ask: "Shall I create these? (yes / adjust …)".

## Turn 2 — write on approval
1. Create the pages, skills, and `tools/<id>/TOOL.md` you proposed as OKF concepts, wiring their dependency links per the vault model. (`index.md` and the graph regenerate automatically; git is the history.)
2. For anything not fully buildable now, record a gap under `backlog/` (`type: gap`, `kind: tool|context|sop|skill`) with a "Still to work out" section — dedup against existing gaps.
3. For each tool needing credentials, tell the owner exactly which connection secrets to set in the dashboard and (for OAuth like gogcli) give the precise terminal commands to run locally — you never handle the values yourself.
4. Report: what you filed and where, which secrets to set + test, and which gaps you logged.

## Hard rules
- Read the staging dir only; write only inside the vault. Never copy secret values anywhere.
- Never run the tools you author; the owner installs + tests them from the dashboard.
- Prefer the tool's documented CLI/endpoints over guessed inline scripts (see onboard-tool).

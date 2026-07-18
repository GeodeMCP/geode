---
name: onboard-workspace
description: Turn a folder/zip the owner dropped into the chat into vault content — reference pages, skills/SOPs, and tools — following the vault's conventions.
---

# Onboarding a dropped workspace

The owner staged a folder or zip (read-only) and asked you to bring it into the vault. Work in two turns: **inspect + propose**, then **write on approval**.

**In turn 1 you write NOTHING to the vault — no files, no folders, no edits — even if the task seems obvious.** Ending your turn with a proposal and a yes/no question is the expected, correct flow; it is NOT the disallowed "asking a question mid-run" (you are completing your turn normally, and the owner replies in their next message). Creating or editing vault files before they approve is a mistake — do not rationalize your way past this gate.

## Turn 1 — inspect and propose (write nothing yet)

**Translate into the vault model — don't mirror the source.** The drop has its own organization (folders, maybe its own index/catalog/log, a `CLAUDE.md`/schema, a raw+wiki split). The vault has exactly one model — see **The vault model** in your operating rules. Your job is to deliberately map the *content* into that model, not to drop the source's folders into the nearest-matching vault folder. Never copy the source's `CLAUDE.md`/schema or recreate its index/catalog/log/`raw`/`wiki` scaffolding. For each item, ask: what concept is this in *this* vault, which existing page does it extend or relate to, and what should it link to. If the source implies a concept the vault should have (a new domain), propose creating it deliberately.

1. Explore the staged directory named in the request. Read READMEs, any `CLAUDE.md`/`AGENTS.md`, `config`, `reference/`, `.claude/skills/*`, and `bin/` — to understand the source, not to adopt its schema.
2. Classify every meaningful item into exactly one of:
   - **knowledge** — reference docs, conventions, domain notes → OKF pages in the vault (kebab-case, `type` in frontmatter, one topic per file).
   - **skills / SOPs** — `.claude/skills/*/SKILL.md` or documented procedures → vault recipes (`type: skill`). Rewrite `./bin/<tool> …` calls to `invoke(<tool>, <action>, …)`, local file paths to vault page references, and any "present a table, wait for go/skip/edit" confirmation into a **turn-based** step ("propose the table, stop, continue next turn").
   - **tools** — credentialed CLIs/APIs under `bin/` → `tools/<id>/TOOL.md` per the onboard-tool skill. One **connection per real account** (e.g. one per admin/mailbox); REST verbs → named `http` actions with templated JSON bodies; secret **key names** only via `requires` — never values.
3. Present a filing plan: for each item, its target path + kind, the tools you'll author with their connections, and **which secrets the owner must set** (list the exact `<tool>__<connection>__<KEY>` refs). If something needed can't be fully built yet (e.g. an OAuth/browser tool), note it as a gap you'll record.
4. **Stop.** Ask: "Shall I create these? (yes / adjust …)".

## Turn 2 — write on approval
1. Create the pages, skills, and `tools/<id>/TOOL.md` you proposed as OKF concepts, wiring their dependency links per the vault model. (`index.md` and the graph regenerate automatically; git is the history — never hand-maintain a catalog or changelog.)
2. For anything not fully buildable now, record a gap under `backlog/` (`type: gap`, `kind: tool|context|sop|skill`) with a "Still to work out" section — dedup against existing gaps.
3. For each tool needing credentials, tell the owner exactly which connection secrets to set in the dashboard and (for OAuth like gogcli) give the precise terminal commands to run locally — you never handle the values yourself.
4. Report: what you filed and where, which secrets to set + test, and which gaps you logged.

## Hard rules
- Read the staging dir only; write only inside the vault. Never copy secret values anywhere.
- Never run the tools you author; the owner installs + tests them from the dashboard.
- Prefer the tool's documented CLI/endpoints over guessed inline scripts (see onboard-tool).

# Kernel E2E smoke (manual)

This validates the real Agent SDK path against a fixture workspace. It needs a reachable model
(local Ollama is cheapest) and is run by hand, because agent output is non-deterministic. It is
intentionally **not** part of `npm test`.

Prereqs: a model is reachable (e.g. `ollama serve` with a tool-capable model, or `ANTHROPIC_API_KEY`).

1. `export GEODE_AUTH_TOKEN=test-token GEODE_WORKSPACE=$(mktemp -d)`
2. `npm start`
3. In another shell, point an MCP client (e.g. `npx @modelcontextprotocol/inspector`) at
   `http://localhost:8787/mcp` with header `Authorization: Bearer test-token`.
4. Call `find` with `{ "path": "." }` → expect a JSON listing including `log.md`.
5. Call `delegate` with:
   `{ "instruction": "Create a file notes/hello.md containing one sentence about this vault, then summarize what you did." }`
   - Expect: progress notifications stream, a final text summary returns.
   - Verify invariants in `$GEODE_WORKSPACE`:
     - `git log --oneline` shows a new `delegate run-…` commit
     - `notes/hello.md` exists
     - `log.md` gained an `## [..] run-… | ok | <hash>` entry
6. Call `delegate` with an instruction that forces a failing bash command →
   verify the workspace is clean (`git status` empty) and `log.md` gained a `| error` entry.

## Context tools (#2) — manual checks

7. On startup the vault is seeded: verify `AGENTS.md`, `index.md`, `capabilities.md` exist in
   `$GEODE_WORKSPACE` and were committed (`chore: seed vault scaffolds …`).
8. Call `list_capabilities` (no args) → expect the seeded `capabilities.md` content (or the
   fallback note if absent).
9. Call `remember` with
   `{ "content": "Client X prefers invoices on the 1st, net-30 terms.", "source": "call 2026-06-17", "title": "Client X billing" }`.
   - Expect: progress streams, a summary of what was filed where, `isError` is false.
   - Verify in `$GEODE_WORKSPACE`: a new `delegate run-… : …` commit + a `delegate run-… : log`
     commit; the content filed into a page (e.g. under `clients/`); `index.md` updated;
     `capabilities.md` possibly updated; an `ok` entry in `log.md`.
10. Call `list_capabilities` again → expect it to reflect any capability the agent recorded.

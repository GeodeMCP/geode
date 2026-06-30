# Kernel E2E smoke (manual)

This validates the real Agent SDK + HTTP path against a fixture workspace. It needs a reachable
model (local Ollama is cheapest, or `ANTHROPIC_API_KEY`) and is run by hand, because agent output is
non-deterministic. It is intentionally **not** part of `npm test`.

Current tool surface: `query` · `remember` · `list_capabilities` · `invoke` (+ the `GET /artifacts/*`
download route). The vault **prepares/explains**; the **caller executes** via `invoke`; the agent
never calls tools and never touches secrets.

Prereqs: a model is reachable (e.g. `ollama serve` with a tool-capable model, or `ANTHROPIC_API_KEY`).

## Setup

1. `export GEODE_AUTH_TOKEN=test-token GEODE_WORKSPACE=$(mktemp -d)`
   (optionally `export GEODE_SECRETS_DIR=$(mktemp -d)` to keep test secrets out of `~/.geode`).
2. `npm start`
3. In another shell, point an MCP client (e.g. `npx @modelcontextprotocol/inspector`) at
   `http://localhost:8787/mcp` with header `Authorization: Bearer test-token`.

## Seeding (startup)

4. On first boot the vault is seeded: verify `AGENTS.md` and `index.md` exist in `$GEODE_WORKSPACE`
   and were committed (`chore: seed vault scaffolds …`). There is **no** `capabilities.md`
   (discovery is derived). Verify `.gitignore` contains `artifacts/`.

## `query` (agentic; prepares, never executes externally)

5. Call `query` with:
   `{ "instruction": "Create a file notes/hello.md containing one sentence about this vault, then summarize what you did." }`
   - Expect: progress notifications stream, a final text summary returns.
   - Verify in `$GEODE_WORKSPACE`: `git log --oneline` shows a new `query run-…` commit;
     `notes/hello.md` exists; `log.md` gained an `… | ok | <hash>` entry.
6. Call `query` with an instruction that forces a failing bash command →
   verify the workspace is clean (`git status` empty) and `log.md` gained an `| error` entry.

## `remember` (ingest; the compounding loop)

7. Call `remember` with
   `{ "content": "Client X prefers invoices on the 1st, net-30 terms.", "source": "call 2026-06-17", "title": "Client X billing" }`.
   - Expect: progress streams, a summary of what was filed where, `isError` is false.
   - Verify: a new `query run-… : …` commit + a `query run-… : log` commit; the content filed into a
     page (e.g. under `clients/`); `index.md` updated; an `ok` entry in `log.md`.

## `list_capabilities` (derived discovery)

8. Call `list_capabilities` (no args) → expect a rendered menu **derived** from tool manifests
   (`tools/*/TOOL.md`) + OKF frontmatter on recipe/skill/sop pages. On a fresh vault with
   no tools and no recipes, expect the empty/"nothing yet" rendering.

## Secret broker + `invoke` (caller executes; server injects the secret)

9. Add a sample tool to the vault (a copy lives at `examples/tools/httpbin/`):
   ```bash
   mkdir -p "$GEODE_WORKSPACE/tools/httpbin"
   cp examples/tools/httpbin/TOOL.md "$GEODE_WORKSPACE/tools/httpbin/TOOL.md"
   ```
   The connection `default` does a `GET https://httpbin.org/headers` injecting
   `X-Demo: Bearer ${secrets.httpbin__default__DEMO_KEY}`.
10. Set the secret (hidden prompt; never echoed, never through the agent):
    `npm run secret -- set httpbin__default__DEMO_KEY`  (type any value, e.g. `sk-test-123`), then
    `npm run secret -- list` → shows `httpbin__default__DEMO_KEY`.
11. Call `query` with `{ "instruction": "How do I call the httpbin tool to echo my headers? Give me the exact invoke call." }`
    - Expect: the agent reads `tools/httpbin/TOOL.md` and returns an executable plan —
      the exact `invoke(tool: "httpbin", connection: "default", action: "headers", params: {})` to make. It must
      **not** read or reveal `httpbin__default__DEMO_KEY` (it has no access to secrets).
12. Call `invoke` with `{ "tool": "httpbin", "connection": "default", "action": "headers" }`.
    - Expect: `status` 200 and a body whose echoed `headers` include `"X-Demo": "Bearer sk-test-123"`,
      proving the server injected the secret into the outbound request.
    - The secret appears only because httpbin echoes the request header; confirm our `InvokeResult`
      doesn't leak it anywhere else.
13. Call `invoke` with a missing secret (e.g. after `npm run secret -- rm httpbin__default__DEMO_KEY`) → expect a clear
    error naming `httpbin__default__DEMO_KEY` and the `npm run secret -- set httpbin__default__DEMO_KEY` command. Re-add it afterwards.

## Artifacts (download: bearer by default, opt-in signed public URL)

14. Produce an artifact, e.g. `query` with
    `{ "instruction": "Write a short markdown report to artifacts/report.md and tell me where you put it." }`.
    - Expect: the `query` result lists the artifact under `Artifacts:` with a bearer URL
      (`http://localhost:8787/artifacts/report.md`), and the file exists in `$GEODE_WORKSPACE/artifacts/`
      but is **not** committed (gitignored).
15. Download with the bearer token (should succeed):
    `curl -H "Authorization: Bearer test-token" http://localhost:8787/artifacts/report.md`
16. Download with no auth (should 401):
    `curl -i http://localhost:8787/artifacts/report.md` → `401`.
17. Download with a signed public URL (should succeed without a bearer): mint one (e.g. via a tiny
    node snippet using `createArtifactStore(...).mintPublicUrl("report.md")`, or expose it from a tool
    later) and `curl` it → `200`. A tampered `sig` or past `exp` → `403`.
18. Path traversal is rejected: `curl -H "Authorization: Bearer test-token" "http://localhost:8787/artifacts/../package.json"` → not served (`400`/`404`).

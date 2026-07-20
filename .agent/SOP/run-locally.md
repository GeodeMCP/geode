# SOP — Run the kernel locally

**Related docs:** [Architecture & runtime](../System/architecture.md) · [Dashboard & frontend](../System/dashboard-and-frontend.md)

## Start it

```bash
npx tsx --env-file=.env src/index.ts
```

> **`npm start` alone does not load `.env`.** The `start` script is bare `tsx src/index.ts` with no `--env-file`, so it will fail on the required-var check unless the variables are already exported in your shell. Use the command above.

Local vault lives at `~/geode-vault`. Dashboard and MCP both come up on `:8787` — MCP at `http://localhost:8787/mcp` with `Authorization: Bearer $GEODE_AUTH_TOKEN`.

## Required env

`GEODE_AUTH_TOKEN` and `GEODE_WORKSPACE` are the only hard requirements; everything else has a default. Pick one model connector:

- Cloud: `ANTHROPIC_API_KEY`
- Local Ollama: `ANTHROPIC_BASE_URL=http://localhost:11434` (Ollama ≥ 0.14.0)
- LiteLLM proxy: `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`

A loopback `ANTHROPIC_BASE_URL` is auto-added to the sandbox network allowlist and flips `allowLocalBinding` on — that is how a local model works.

## Two failure modes that waste time

### "spawn git ENOENT"

**This message is misleading.** It usually means `GEODE_WORKSPACE` points at a directory that does not exist, not that git is missing. Check the path first:

```bash
ls -d "$GEODE_WORKSPACE" || mkdir -p "$GEODE_WORKSPACE"
```

### A stale kernel is already holding 8787

A leftover kernel from an earlier session can hold the port and serve **old vault and code state** — the dashboard will look fine while reflecting a stale branch. Verify the process start time before trusting anything it shows:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN     # get the pid
ps -o pid,lstart,command -p <pid>    # is it as old as your last edit?
```

Kill and restart if the start time predates your work.

## Rebuilding the dashboard SPA

The server serves `web/dist` directly and **no root script builds it**. After frontend changes:

```bash
cd web && npm run build
```

If `web/dist` is missing, every non-API GET returns `503 "Dashboard SPA not built."`

Under `vite dev`, only `/api` is proxied to `:8787` — `/auth` and `/artifacts` are not, so secret-link and artifact flows need port 8787 directly.

## Checks before pushing

```bash
npm test              # vitest
npm run typecheck
npm run lint          # ESLint — NOT the vault lint
tsx src/lintCli.ts    # the vault health pass; no npm script exists
```

A husky pre-commit gate runs lint-staged. **New exports need JSDoc or the commit is blocked.**

# Caller-surface eval

Measures how well different MCP tool-surfaces let an arbitrary caller agent discover + use the vault. See the spec: `docs/superpowers/specs/2026-06-26-mcp-caller-surface-eval-design.md`.

## Run

```
ANTHROPIC_API_KEY=… npm run eval
```

Env knobs: `GEODE_EVAL_TIERS=strong,weak` · `GEODE_EVAL_CONFIGS=leading,B-query-only` · `GEODE_EVAL_REPEATS=3` · `GEODE_EVAL_STRONG=…` · `GEODE_EVAL_WEAK=…` · `GEODE_EVAL_DRY=1` (offline scripted model).

## What it scores (from the tool-call trace)

disc=reached in when it should · retr=right content reached the caller · invk=right tool+action+connection · false=touched vault on a negative (lower better) · rem=remembered when expected · qry/leg=heavy `query` calls (lower better).

## Iterating

Edit `configs.ts` (tools/descriptions/instructions/listMode) and re-run. Results in `results/latest.json`.

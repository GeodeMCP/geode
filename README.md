# Geode Kernel

The MCP web service that runs the Geode vault agent over a git-backed workspace.

## Run

```bash
# Required
export GEODE_AUTH_TOKEN="choose-a-long-random-token"
export GEODE_WORKSPACE="$HOME/geode-vault"

# Model connector (pick one):
#  - Cloud Claude:   export ANTHROPIC_API_KEY="sk-ant-..."
#  - Local (Ollama): export ANTHROPIC_BASE_URL="http://localhost:11434"  (Ollama >= 0.14.0)
#  - LiteLLM proxy:  export ANTHROPIC_BASE_URL="http://localhost:4000" ANTHROPIC_AUTH_TOKEN="..."
# Optional: GEODE_MODEL, GEODE_PORT (default 8787), GEODE_MAX_RUNTIME_MS, GEODE_QUEUE_LIMIT

mkdir -p "$GEODE_WORKSPACE"
npm start
```

Connect any MCP client to `http://localhost:8787/mcp` with header `Authorization: Bearer $GEODE_AUTH_TOKEN`.
Tools: `find` (cheap retrieval) and `delegate` (the agent).

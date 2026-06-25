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
Tools: `query` (ask the vault — returns an answer or an executable `invoke` plan), `remember` (file a distilled note), `list_capabilities` (the derived menu of recipes + integrations), and `invoke` (the caller runs one integration action; the server injects the secret). The vault prepares and explains; the caller executes via `invoke`.

### First run / account

The dashboard (the management UI) mounts by default at `http://localhost:8787/`.

- **No password, no owner yet:** if `GEODE_DASHBOARD_PASSWORD` is unset and no owner account exists, opening the dashboard shows a one-time **"Create your vault"** screen (email + password). The credential is stored scrypt-hashed at `~/.geode/account.json` (override the directory with `GEODE_ACCOUNT_DIR`). After that, sign in with email + password.
- **Env-password login:** `GEODE_DASHBOARD_PASSWORD` remains a valid env-login. A logged-in operator can upgrade to a real account via the setup screen ("Create your vault"); once created, the account supersedes the env password on the next login.
- **Recovery (machine-local break-glass):** `npm run owner -- show | create <email> | set-password | reset` (`reset` removes the owner record so first-run setup runs again).

**Security when exposing the kernel publicly:** the dashboard login and the static `GEODE_AUTH_TOKEN` bearer both become internet-reachable once the kernel is public. Use a strong password, and prefer exposing only the connector routes (`/mcp`, and later the OAuth routes) through your reverse proxy — keep the dashboard private.

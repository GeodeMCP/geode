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

The dashboard (the management UI) always mounts at `http://localhost:8787/`. Auth is **account-only**: a single owner account (email + password, scrypt-hashed). Create the owner one of three ways:

- **Interactive local install:** open the dashboard with no owner yet → a one-time **"Create your vault"** screen (email + password). The credential is stored scrypt-hashed at `~/.geode/account.json` (override the directory with `GEODE_ACCOUNT_DIR`). After that, sign in with email + password.
- **Headless / fleet provisioning (env bootstrap):** set `GEODE_OWNER_EMAIL` and `GEODE_OWNER_PASSWORD`. On first boot with no owner, a hashed account is created from them; the variables are then inert (subsequent boots ignore them, since an owner now exists).
- **CLI:** `npm run owner -- create <email>`.

Once an owner exists, login is always email + password.

- **Recovery (machine-local break-glass):** `npm run owner -- show | create <email> | set-password | reset` (`reset` removes the owner record so first-run setup runs again).

**Security when exposing the kernel publicly:** the dashboard always mounts, so a fresh, ownerless, publicly-exposed kernel can be **claimed by the first visitor** via the "Create your vault" screen. Always **create the owner first** (CLI or `GEODE_OWNER_EMAIL`/`GEODE_OWNER_PASSWORD`) before exposing the kernel publicly. The dashboard login and the static `GEODE_AUTH_TOKEN` bearer both become internet-reachable once the kernel is public — use a strong password, and prefer exposing only the connector routes (`/mcp`, and later the OAuth routes) through your reverse proxy, keeping the dashboard private.

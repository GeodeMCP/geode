# Geode Kernel

> **Your assistant is replaceable. Your context, SOPs, integrations, and credentials shouldn't be.**
> Geode is the tool-agnostic vault in the middle — set it up once, plug in any AI assistant over MCP. See [`docs/`](docs/) for what Geode is and how it's built.

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

### Agent sandbox

The sandboxed agent enforces OS-level confinement (via seatbelt on macOS, bubblewrap on Linux). It runs with `permissionMode: "default"` plus a non-interactive permission handler — never `bypassPermissions` — that confines file writes to the vault, denies `WebFetch`/`WebSearch`, and refuses any command that opts out of the sandbox. **File-write confinement holds on both macOS and Linux.** Per-domain **network egress** allowlisting relies on the sandbox proxy and is **enforced on Linux only** (it needs `socat`); on macOS (dev) bash network egress is not restricted, so treat macOS as a development environment, not a hardened one. Configuration:

- `GEODE_AGENT_ALLOWED_DOMAINS` — comma-separated extra domains the sandboxed agent may reach (on top of the LLM host + git/package hosts used for tool onboarding). Default: none.
- `ANTHROPIC_BASE_URL` — override the LLM endpoint (e.g. a local Anthropic-compatible gateway). Its host (loopback included) is auto-added to the network allowlist — this is how a local model is used.
- `GEODE_SANDBOX_DISABLE=1` — dev-only escape hatch that runs the agent UNsandboxed. Off by default; never set in production.

**Linux runtime dependencies:** the sandbox requires `bubblewrap` and `socat` to be installed. The deploy image must include them (e.g., `apt-get install -y bubblewrap socat`). macOS has no additional requirements (seatbelt is built-in). If these binaries are missing and `GEODE_SANDBOX_DISABLE=1` is not set, the agent run will fail closed.

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

### Connect from claude.ai (OAuth)

To add your vault to claude.ai as a custom connector, the kernel needs a **public HTTPS URL** — claude.ai connects from Anthropic's cloud, so `localhost` is unreachable. Put the kernel behind your own reverse proxy or tunnel and set `GEODE_BASE_URL` to that public HTTPS URL:

```bash
export GEODE_BASE_URL="https://vault.example.com"
```

Then, in Claude → **Settings → Connectors → Add custom connector** → paste the URL → **Connect** → sign in with your **owner account** → **Approve**. Claude discovers the OAuth metadata, self-registers (DCR), runs the consent flow, and connects as the owner.

Local clients (Claude Code / Claude Desktop) don't need this — they still use the JSON config shown on the dashboard's **Connect** page with the static `GEODE_AUTH_TOKEN` bearer. A **managed tunnel** for localhost users (so you can connect from claude.ai without running your own proxy) is coming later.

**Security:** as above, **create the owner first** so a public, ownerless kernel can't be claimed by the first visitor, and expose only the connector routes (`/mcp`, `/.well-known/*`, `/register`, `/authorize`, `/token`) through your reverse proxy, keeping the dashboard private.

# Adversarial proof harness for the runner uid trust boundary (slice 1B-1b, Task 5).
#
# This image provisions the same ownership model production deploy provisioning must apply
# (see .agent/SOP/verify-uid-boundary.md) and then runs scripts/verify-uid-boundary.ts as
# the root broker, which drops probe subprocesses to the geode-runner uid/gid (in geode-rw)
# and the geode-fetcher uid/gid (NOT in geode-rw) and asserts both boundaries hold — the
# fetcher is vault-blind. Build+run:
#
#   docker build -t geode-uidcheck . && docker run --rm geode-uidcheck
#
FROM node:20-bookworm

# bubblewrap + socat mirror the real deploy image's runtime deps (SDK OS sandbox +
# per-host egress proxy, per .agent/SOP/verify-sandbox.md) so this image documents the
# same provisioning surface, even though this specific harness only exercises git.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap socat git \
    && rm -rf /var/lib/apt/lists/*

# Shared group for the broker/runner filesystem trust boundary. Fixed uid/gid so the
# harness (and any human re-running it) can rely on them via GEODE_RUNNER_UID/GID below.
RUN groupadd -g 5000 geode-rw \
    && useradd -m -u 5001 -g geode-rw -s /usr/sbin/nologin geode-runner \
    && usermod -aG geode-rw root

# The fetcher: a distinct third principal with its own private group, deliberately NOT a
# member of geode-rw (contrast with geode-runner above) — this is what makes the 2770 vault
# deny it. Fixed uid/gid via GEODE_FETCHER_UID/GID below.
RUN groupadd -g 5002 geode-fetcher \
    && useradd -m -u 5002 -g geode-fetcher -s /usr/sbin/nologin geode-fetcher

# The harness is filesystem-deterministic and imports no application code — only tsx is
# needed to run the TypeScript file directly, so the full `npm ci` dependency tree (and
# any ANTHROPIC_API_KEY) is intentionally skipped to keep this image lean.
RUN npm install -g tsx@4.22.4

WORKDIR /app
COPY scripts/verify-uid-boundary.ts scripts/verify-uid-boundary.ts

ENV GEODE_RUNNER_UID=5001 \
    GEODE_RUNNER_GID=5000 \
    GEODE_FETCHER_UID=5002 \
    GEODE_FETCHER_GID=5002

# Runs as root (the broker) by default — required to drop the probe to geode-runner's uid/gid.
CMD ["tsx", "scripts/verify-uid-boundary.ts"]

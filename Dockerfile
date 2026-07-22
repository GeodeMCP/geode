# Adversarial proof harness for the runner uid trust boundary (slice 1B-1b, Task 5).
#
# This image provisions the same ownership model production deploy provisioning must apply
# (see .agent/SOP/verify-uid-boundary.md) and then runs scripts/verify-uid-boundary.ts as
# the root broker, which drops a probe subprocess to the geode-runner uid/gid and asserts
# the boundary holds. Build+run:
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

# The harness is filesystem-deterministic and imports no application code — only tsx is
# needed to run the TypeScript file directly, so the full `npm ci` dependency tree (and
# any ANTHROPIC_API_KEY) is intentionally skipped to keep this image lean.
RUN npm install -g tsx@4.22.4

WORKDIR /app
COPY scripts/verify-uid-boundary.ts scripts/verify-uid-boundary.ts

ENV GEODE_RUNNER_UID=5001 \
    GEODE_RUNNER_GID=5000

# Runs as root (the broker) by default — required to drop the probe to geode-runner's uid/gid.
CMD ["tsx", "scripts/verify-uid-boundary.ts"]

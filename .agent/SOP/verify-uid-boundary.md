# SOP — Verify the runner/fetcher uid trust boundaries on a privileged Linux host

Run this on a **privileged Linux host** (root, or a container — the provided `Dockerfile`) to prove the runner→broker process boundary (slice 1B-1b) and the fetcher→vault boundary (slice 1B-2) are real OS-enforced trust boundaries, not just the SDK's own permission layer. It is manual — no CI exists for this yet.

**Related docs:** [Security model — process boundary](../System/security-model.md#process-boundary-runner-subprocess) · [Verify the sandbox](verify-sandbox.md) · [`src/runner/provision.ts`](../../src/runner/provision.ts)

## The ownership model

Deploy-time OS provisioning (not code in this repo — applied by whoever provisions the host) must set up:

| Path | Owner | Mode | Why |
|---|---|---|---|
| `<secretsDir>` (`~/.geode/secrets`) | broker | `0700` | Covers `secrets.enc`, the AES `key`, and the `sign`/`oauth`/`session`/`link` subkeys. Broker-only — this is the actual boundary the runner uid must not cross. |
| `<workspaceRoot>` (the vault working tree) | broker : `geode-rw` | `2770` (setgid), recursive | The runner writes here directly; the broker still needs to `git add`/`commit`/`reset --hard`/`clean -fd` runner-owned files. Setgid propagates the shared group onto files/dirs the runner creates, **including nested ones** — but only if the runner's process runs under `umask 002` (a `022` umask would drop the group-write bit on every new file/dir). |
| `~/.geode` (the shared parent) | broker | `0711` | Traversable by anyone (so the runner can reach `uploads`), but not listable — `secrets`/`transcripts`/`tools`/the account file all sit under here and must not be enumerable by the runner. |
| `~/.geode/uploads` | broker : `geode-rw` | group-readable | Attachment staging — the runner reads here (read-only), unlike its siblings. |
| `~/.geode/{transcripts,tools}`, account files | broker | `0700` | Broker-only, same as secrets. |
| `runnerHome` (`GEODE_RUNNER_HOME`) | runner | — | Owned by the runner user; the SDK's bundled CLI writes config/debug here. |
| a per-run fetch-staging dir (e.g. `~/.geode/fetch-staging/<runId>`) | **fetcher**-owned | `0700` (or fetcher-owned, broker-readable if the librarian needs it back) | Where the fetcher deposits its distillate. Not the vault, and not `geode-rw`-shared — the fetcher owns this outright. |
| `fetcherHome` (`GEODE_FETCHER_HOME`) | fetcher | — | Owned by the fetcher user; same purpose as `runnerHome`, for the distinct fetcher uid. |

**A shared group (`geode-rw`)** contains both the broker user and the runner/librarian user (`geode-runner`, uid = `GEODE_RUNNER_UID`). **Both `GEODE_RUNNER_UID` and `GEODE_RUNNER_GID` are required** — the gid must be the shared group's gid, or the shared-group write model above breaks (a runner process with its own private primary gid would fail to write into the `2770` working tree, or — worse — files it creates would carry the wrong group and the broker couldn't reconcile them).

**The fetcher (`geode-fetcher`, uid = `GEODE_FETCHER_UID`) is deliberately NOT a member of `geode-rw`.** It gets its own private group (`GEODE_FETCHER_GID`) — **both `GEODE_FETCHER_UID` and `GEODE_FETCHER_GID` are required**, mirroring the runner's requirement above. This is the whole point of the slice-1B-2 split: the fetcher handles hostile external input over a broad network egress, so it must be vault-blind — the `2770` vault denies "other," and the fetcher is "other." Its only write target is its own staging dir; the librarian (in `geode-rw`) reads that staging dir and is the one that actually authors the vault.

This model is implemented in the kernel by `provisionRunner` / `resolveRunnerPrivilege` (`src/runner/provision.ts`): it decides drop-vs-fallback and scrubs the runner's env to an allowlist, and selects between the runner/librarian identity and the fetcher identity by role. The directory ownership/permissions themselves are host provisioning, not kernel code — which is why this is a separate, standalone Docker harness rather than a unit test.

## What `scripts/verify-uid-boundary.ts` proves

The harness reproduces the model above from scratch in a temp dir (no live vault needed) and asserts, filesystem-deterministically:

| Probe (run as the `geode-runner` uid/gid) | Expected |
|---|---|
| `readFile(secrets.enc)` | fails with `EACCES` |
| `readFile(<staged upload>)` | succeeds |
| `write` a top-level file into the vault | succeeds |
| `write` a **nested** file into the vault (proves `umask 002` keeps it group-writable, not just top-level) | succeeds |
| `stat` the runner-created nested dir | the **setgid bit is actually set** — inherited from the `2770` parent, not just "the write succeeded" (a plain `0770` parent would let the write succeed too, since the probe's own gid is already the shared group; only the bit check proves the parent is really setgid) |
| Broker: `git add -A && git commit` the runner's writes | succeeds |
| Broker: a second runner write, then `git reset --hard && git clean -fd` | the runner-owned nested dir is removed; the already-committed file survives |

Then, run as the `geode-fetcher` uid/gid (**not** in `geode-rw`) — the slice 1B-2 (Task 7) proof that the fetcher is vault-blind:

| Probe (run as the `geode-fetcher` uid/gid) | Expected |
|---|---|
| `readFile` a vault file (e.g. `README.md`) | fails with `EACCES` — the `2770` vault denies "other," and the fetcher is not in `geode-rw` |
| `readFile(secrets.enc)` | fails with `EACCES` |
| `write` into the fetcher's own staging dir | succeeds |
| `write` a file directly into the vault | fails with `EACCES` |

It requires `GEODE_RUNNER_UID`/`GEODE_RUNNER_GID` and `GEODE_FETCHER_UID`/`GEODE_FETCHER_GID` in the environment and must run as root (it drops privilege *to* each uid/gid pair in turn — it cannot do that unprivileged). No API key, no LLM — exits non-zero on the first failed assertion with a clear PASS/FAIL report.

## Run it

```bash
docker build -t geode-uidcheck . && docker run --rm geode-uidcheck
```

The `Dockerfile` provisions `geode-rw` (gid 5000) and `geode-runner` (uid 5001, in `geode-rw`; the broker/root is added to `geode-rw` too), plus `geode-fetcher` (uid 5002, its own private group gid 5002, **not** in `geode-rw`). It sets `GEODE_RUNNER_UID=5001` / `GEODE_RUNNER_GID=5000` and `GEODE_FETCHER_UID=5002` / `GEODE_FETCHER_GID=5002`, and defaults to running the harness as root.

### Expected output

Real output from `docker build -t geode-uidcheck . && docker run --rm geode-uidcheck` (slice 1B-2, Task 7):

```
=== uid-boundary verification ===
runner uid=5001 gid=5000 | fetcher uid=5002 gid=5002 | secretsDir=/tmp/geode-uidcheck-XXXXXX/secrets | vaultDir=/tmp/geode-uidcheck-XXXXXX/vault | fetcherStagingDir=/tmp/geode-uidcheck-XXXXXX/fetcher-staging
PASS — runner denied read of secrets.enc with EACCES
PASS — runner can read the staged upload
PASS — runner can write a top-level vault file
PASS — runner can write a nested vault file
PASS — nested vault file exists on disk
PASS — nested vault file is owned by the runner uid
PASS — runner-created nested dir inherited the setgid bit from the 2770 parent
PASS — broker can git add+commit the runner-written files
PASS — second runner write (uncommitted) succeeded
PASS — dirty nested file exists before reset/clean
PASS — broker can git reset --hard + clean -fd the runner-owned nested dir
PASS — dirty nested file removed after clean -fd
PASS — committed nested file survives reset (still present)
PASS — fetcher denied read of a vault file with EACCES (not in geode-rw)
PASS — fetcher denied read of secrets.enc with EACCES
PASS — fetcher can write its own staging dir
PASS — fetcher denied write to the vault with EACCES

UID BOUNDARY HOLDS — runner cannot read secrets.enc; broker can still commit and reconcile runner writes. FETCHER IS VAULT-BLIND — EACCES reading the vault and secrets.enc, but can write its own staging dir.
```

Exit code `0` on all-PASS; non-zero (with `FAIL` lines) otherwise.

## What this does *not* cover

- **This is the ownership model in isolation**, not a full deploy image — it does not exercise `provisionRunner`, the SDK sandbox, or a real vault/account layout. It proves the OS permissions are correct in principle; wiring the real `secretsDir`/`workspaceRoot`/`~/.geode`/fetch-staging paths on an actual deploy host still needs the provisioning steps in the table above applied for real.
- **macOS is not covered** — `spawn`'s `uid`/`gid` drop and this permission model are meaningless without a privileged Linux host (or a container). Run this in Docker, not on a dev Mac.
- **Egress (hole C)** is untouched by this check — it is scoped to filesystem read/write isolation only. Per-role network egress (`allowedDomains`, `allowWebTools`: fetcher gets a broad allowlist, librarian gets model-host-only + web tools denied) is a separate slice 1B-2 control, exercised by unit tests elsewhere, not this filesystem-only harness.
- **This harness does not exercise the fetcher→librarian staging handoff** — it only proves the fetcher can write its own staging dir and cannot read/write the vault or secrets. Whether the librarian can then read that staging dir back (so it can file the vault from the fetcher's distillate) is real deploy provisioning, not asserted here.

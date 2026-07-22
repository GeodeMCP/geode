# SOP — Verify the runner uid trust boundary on a privileged Linux host

Run this on a **privileged Linux host** (root, or a container — the provided `Dockerfile`) to prove the runner→broker process boundary (slice 1B-1b) is a real OS-enforced trust boundary, not just the SDK's own permission layer. It is manual — no CI exists for this yet.

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

**A shared group (`geode-rw`)** contains both the broker user and the runner user (`geode-runner`, uid = `GEODE_RUNNER_UID`). **Both `GEODE_RUNNER_UID` and `GEODE_RUNNER_GID` are required** — the gid must be the shared group's gid, or the shared-group write model above breaks (a runner process with its own private primary gid would fail to write into the `2770` working tree, or — worse — files it creates would carry the wrong group and the broker couldn't reconcile them).

This model is implemented in the kernel by `provisionRunner` / `resolveRunnerPrivilege` (`src/runner/provision.ts`): it decides drop-vs-fallback and scrubs the runner's env to an allowlist, but the directory ownership/permissions themselves are host provisioning, not kernel code — which is why this is a separate, standalone Docker harness rather than a unit test.

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

It requires `GEODE_RUNNER_UID` and `GEODE_RUNNER_GID` in the environment and must run as root (it drops privilege *to* the runner uid/gid — it cannot do that unprivileged). No API key, no LLM — exits non-zero on the first failed assertion with a clear PASS/FAIL report.

## Run it

```bash
docker build -t geode-uidcheck . && docker run --rm geode-uidcheck
```

The `Dockerfile` provisions `geode-rw` (gid 5000) and `geode-runner` (uid 5001, in `geode-rw`; the broker/root is added to `geode-rw` too), sets `GEODE_RUNNER_UID=5001` / `GEODE_RUNNER_GID=5000`, and defaults to running the harness as root.

### Expected output

```
=== uid-boundary verification ===
runner uid=5001 gid=5000 | secretsDir=/tmp/geode-uidcheck-XXXXXX/secrets | vaultDir=/tmp/geode-uidcheck-XXXXXX/vault
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

UID BOUNDARY HOLDS — runner cannot read secrets.enc; broker can still commit and reconcile runner writes.
```

Exit code `0` on all-PASS; non-zero (with `FAIL` lines) otherwise.

## What this does *not* cover

- **This is the ownership model in isolation**, not a full deploy image — it does not exercise `provisionRunner`, the SDK sandbox, or a real vault/account layout. It proves the OS permissions are correct in principle; wiring the real `secretsDir`/`workspaceRoot`/`~/.geode` paths on an actual deploy host still needs the provisioning steps in the table above applied for real.
- **macOS is not covered** — `spawn`'s `uid`/`gid` drop and this permission model are meaningless without a privileged Linux host (or a container). Run this in Docker, not on a dev Mac.
- **Egress (hole C)** is untouched by this check — it is scoped to filesystem read/write isolation only. Per-role network egress is slice 1B-2.

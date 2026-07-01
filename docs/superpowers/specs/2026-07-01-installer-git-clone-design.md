# Installer fix — clone in a git stage so slim bases can install

**Slice:** #3 executor bug fix. Surfaced live: installing cloakbrowser failed at the very first build step with `exit code: 127`.

**Goal:** A `source.repo` cli tool installs on any base image (including `python:3.12-slim` / `node:20-slim`), which do not ship `git`.

## The bug

`buildDockerfile` (`src/docker.ts:8`) emits, as the first step after the base `FROM`:
```
RUN git clone --depth 1 --branch <ref> <repo> .
```
Slim Debian images (and Alpine) contain **no `git`**, so the clone fails with exit 127 (`git: not found`). Result: **no repo-based cli tool can install on a slim base today** — the common case. (Package-source tools and the `install:` RUNs are unaffected; the failure is purely the clone step needing git in the base image.)

## Decision: multi-stage build with a throwaway `alpine/git` clone stage

Clone in a dedicated `alpine/git` stage and `COPY` the checkout into the base image:
```
FROM alpine/git AS clone
WORKDIR /src
RUN git clone --depth 1 --branch <ref> <repo> .

FROM <base>
WORKDIR /tool
COPY --from=clone /src /tool
RUN <install 1>
RUN <install 2>
```

Why this over the alternatives:
- **vs. prepending `apt-get install git`:** that only works on Debian-family bases (breaks on Alpine/others), and leaves `git` in the final **runtime** image the sandboxed tool executes in — unnecessary surface for a credentials-safety product. The multi-stage approach is base-agnostic and keeps `git` out of the runtime image.
- **vs. cloning on the host + `COPY . .`:** would require building a real host context and reworking `docker.build`; the multi-stage change is confined to the pure `buildDockerfile` function.

`docker build -f - .` (`docker.ts:72`) already handles multi-stage Dockerfiles natively (multiple `FROM`s); the `COPY --from=clone` pulls from the stage, not the host context, so no build-context change is needed. The build has network (it clones + pip/npm anyway), so pulling the small `alpine/git` image is consistent with what the build already does.

## Change — `src/docker.ts` `buildDockerfile` only

```ts
export function buildDockerfile(m: ToolManifest): string {
  const base = m.image?.base ?? "node:20-slim";
  const lines: string[] = [];
  if (m.source?.repo) {
    // Clone in a throwaway git stage: slim bases ship no git, and this keeps git
    // out of the final runtime image the sandboxed tool executes in.
    const ref = m.source.ref ? ` --branch ${m.source.ref}` : "";
    lines.push("FROM alpine/git AS clone", "WORKDIR /src", `RUN git clone --depth 1${ref} ${m.source.repo} .`);
    lines.push(`FROM ${base}`, "WORKDIR /tool", "COPY --from=clone /src /tool");
  } else {
    lines.push(`FROM ${base}`, "WORKDIR /tool");
    if (m.source?.package) {
      lines.push(`RUN ${m.source.package.startsWith("pip:") ? `pip install ${m.source.package.slice(4)}` : `npm install -g ${m.source.package.replace(/^npm:/, "")}`}`);
    }
  }
  for (const cmd of m.install ?? []) lines.push(`RUN ${cmd}`);
  return lines.join("\n") + "\n";
}
```

Behavior preserved: `--branch <ref>` pinning unchanged (arbitrary-commit-SHA support is still a separate deferred follow-up); package-source and install RUNs unchanged; no `${…}` secret ever in the image.

## Testing — `test/docker.test.ts`

The existing `buildDockerfile` test only checks substrings (`FROM node:20-slim`, `git clone`, `v1`, `RUN npm ci/…`) — all still present, so it stays green. Add:
- **Multi-stage clone (repo source):** the Dockerfile contains `FROM alpine/git AS clone` and `COPY --from=clone /src /tool`; and crucially `git clone` runs in the clone stage **before** the base `FROM` — assert `df.indexOf("git clone") < df.indexOf("FROM node:20-slim")`, and that the base stage (`df.slice(df.indexOf("FROM node:20-slim"))`) contains no `git clone`. This pins "the base image never needs git."
- **Package source (no clone stage):** a manifest with `source: { package: "pip:cloakbrowser" }`, `image: { base: "python:3.12-slim" }` → Dockerfile has `FROM python:3.12-slim` + `RUN pip install cloakbrowser`, and does **not** contain `alpine/git` or `git clone`.

## Out of scope
- Sending the whole CWD as build context (`docker build … .`) is pre-existing and wasteful but unrelated; the multi-stage build doesn't read the host context. (Noted for a later optimization.)
- SHA-ref pinning (`--branch` only supports tags/branches) — separate deferred follow-up.
- Pinning `alpine/git` to a digest — consistent with the currently-unpinned base tags; a later hardening.

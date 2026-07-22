import { join } from "node:path";
import type { Config } from "../config.js";

/** Builds the runner subprocess env from an explicit allowlist — never a filtered process.env, so no GEODE_* secret can leak. */
export function buildRunnerEnv(source: NodeJS.ProcessEnv, opts: { home: string; tmpdir: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: source.PATH,
    HOME: opts.home,
    TMPDIR: opts.tmpdir,
  };
  if (source.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = source.ANTHROPIC_API_KEY;
  if (source.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = source.ANTHROPIC_BASE_URL;
  return env;
}

/** Decides whether to drop the runner to a low-priv uid/gid: only when the broker is root AND both a runner uid and gid are configured; otherwise a same-uid fallback with a reason. A uid without a gid is refused rather than dropped — the runner would keep root's group and silently break the shared-group (geode-rw) write model. */
export function resolveRunnerPrivilege(
  config: { runnerUid?: number; runnerGid?: number },
  getuid: () => number | undefined,
): { uid?: number; gid?: number; mode: "dropped" | "same-uid"; reason?: string } {
  if (getuid() !== 0) return { mode: "same-uid", reason: "not running as root" };
  if (config.runnerUid === undefined) return { mode: "same-uid", reason: "no runner uid configured (set GEODE_RUNNER_UID)" };
  if (config.runnerGid === undefined) return { mode: "same-uid", reason: "GEODE_RUNNER_GID also required for the shared-group model (set it to the geode-rw gid)" };
  return { uid: config.runnerUid, gid: config.runnerGid, mode: "dropped" };
}

/** Assembles the runner spawn options for the given role — scrubbed env + optional uid/gid drop —
 * ensuring the role's HOME/TMPDIR exist and logging the trust-boundary mode loudly. "librarian" uses
 * config.runnerUid/runnerGid/runnerHome (the desk/librarian engine); "fetcher" uses config.fetcherUid/
 * fetcherGid/fetcherHome (the distinct-uid fetch engine) — same scrubbed env allowlist either way. */
export function provisionRunner(
  config: Config,
  deps: { pkgRoot: string; getuid: () => number | undefined; log: (m: string) => void; ensureDir: (p: string) => void; source: NodeJS.ProcessEnv },
  role: "librarian" | "fetcher",
): { cwd: string; env: NodeJS.ProcessEnv; uid?: number; gid?: number } {
  const picked = role === "fetcher"
    ? { uid: config.fetcherUid, gid: config.fetcherGid, home: config.fetcherHome }
    : { uid: config.runnerUid, gid: config.runnerGid, home: config.runnerHome };
  const tmpdir = join(picked.home, "tmp");
  deps.ensureDir(picked.home);
  deps.ensureDir(tmpdir);
  const env = buildRunnerEnv(deps.source, { home: picked.home, tmpdir });
  const priv = resolveRunnerPrivilege({ runnerUid: picked.uid, runnerGid: picked.gid }, deps.getuid);
  if (priv.mode === "dropped") deps.log(`[runner] privilege: dropped to uid ${priv.uid} gid ${priv.gid ?? "(default)"}`);
  else deps.log(`[runner] privilege: SAME-UID (${priv.reason}) — no trust boundary between broker and agent; dev only`);
  return { cwd: deps.pkgRoot, env, uid: priv.uid, gid: priv.gid };
}

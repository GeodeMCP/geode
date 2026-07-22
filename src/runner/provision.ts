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

/** Decides whether to drop the runner to a low-priv uid/gid: only when the broker is root AND a runner uid is configured; otherwise a same-uid fallback with a reason. */
export function resolveRunnerPrivilege(
  config: { runnerUid?: number; runnerGid?: number },
  getuid: () => number | undefined,
): { uid?: number; gid?: number; mode: "dropped" | "same-uid"; reason?: string } {
  if (getuid() !== 0) return { mode: "same-uid", reason: "not running as root" };
  if (config.runnerUid === undefined) return { mode: "same-uid", reason: "no runner uid configured (set GEODE_RUNNER_UID)" };
  return { uid: config.runnerUid, gid: config.runnerGid, mode: "dropped" };
}

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

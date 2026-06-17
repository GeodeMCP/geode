export interface Config {
  authToken: string;
  workspaceRoot: string;
  port: number;
  model?: string;
  maxRuntimeMs: number;
  queueLimit: number;
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    authToken: required(env, "GEODE_AUTH_TOKEN"),
    workspaceRoot: required(env, "GEODE_WORKSPACE"),
    port: env.GEODE_PORT ? Number(env.GEODE_PORT) : 8787,
    model: env.GEODE_MODEL || undefined,
    maxRuntimeMs: env.GEODE_MAX_RUNTIME_MS ? Number(env.GEODE_MAX_RUNTIME_MS) : 300000,
    queueLimit: env.GEODE_QUEUE_LIMIT ? Number(env.GEODE_QUEUE_LIMIT) : 4,
  };
}

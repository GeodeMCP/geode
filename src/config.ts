import { homedir } from "node:os";
import { join } from "node:path";

/** All runtime configuration values resolved from environment variables. */
export interface Config {
  authToken: string;
  workspaceRoot: string;
  port: number;
  model?: string;
  maxRuntimeMs: number;
  queueLimit: number;
  secretsDir: string;
  artifactsDir: string;
  transcriptsDir: string;
  baseUrl: string;
  ownerEmail?: string;
  ownerPassword?: string;
  accountDir: string;
  runnerUid?: number;
  runnerGid?: number;
  runnerHome: string;
  fetcherUid?: number;
  fetcherGid?: number;
}

/** Reads a required environment variable from the given env map, throwing if the key is absent or empty. */
function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

/** Reads environment variables and returns a fully resolved Config, throwing if any required variable is absent. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    authToken: required(env, "GEODE_AUTH_TOKEN"),
    workspaceRoot: required(env, "GEODE_WORKSPACE"),
    port: env.GEODE_PORT ? Number(env.GEODE_PORT) : 8787,
    model: env.GEODE_MODEL || undefined,
    maxRuntimeMs: env.GEODE_MAX_RUNTIME_MS ? Number(env.GEODE_MAX_RUNTIME_MS) : 300000,
    queueLimit: env.GEODE_QUEUE_LIMIT ? Number(env.GEODE_QUEUE_LIMIT) : 4,
    secretsDir: env.GEODE_SECRETS_DIR || join(homedir(), ".geode", "secrets"),
    artifactsDir: env.GEODE_ARTIFACTS_DIR || join(required(env, "GEODE_WORKSPACE"), "artifacts"),
    transcriptsDir: env.GEODE_TRANSCRIPTS_DIR || join(homedir(), ".geode", "transcripts"),
    baseUrl: env.GEODE_BASE_URL || `http://localhost:${env.GEODE_PORT ? Number(env.GEODE_PORT) : 8787}`,
    ownerEmail: env.GEODE_OWNER_EMAIL || undefined,
    ownerPassword: env.GEODE_OWNER_PASSWORD || undefined,
    accountDir: env.GEODE_ACCOUNT_DIR || join(homedir(), ".geode"),
    runnerUid: env.GEODE_RUNNER_UID ? Number(env.GEODE_RUNNER_UID) : undefined,
    runnerGid: env.GEODE_RUNNER_GID ? Number(env.GEODE_RUNNER_GID) : undefined,
    runnerHome: env.GEODE_RUNNER_HOME || join(homedir(), ".geode", "runner-home"),
    fetcherUid: env.GEODE_FETCHER_UID ? Number(env.GEODE_FETCHER_UID) : undefined,
    fetcherGid: env.GEODE_FETCHER_GID ? Number(env.GEODE_FETCHER_GID) : undefined,
  };
}

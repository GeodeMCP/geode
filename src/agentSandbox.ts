/** Resolved OS-sandbox policy for the vault agent, derived once from env + the vault root. */
export interface SandboxPolicy {
  enabled: boolean;
  failIfUnavailable: boolean;
  allowWrite: string[];
  allowedDomains: string[];
  allowLocalBinding: boolean;
}

/** The subset of the Agent SDK's SandboxSettings we construct (structural; flows into the untyped SDK options). */
export interface SandboxSettings {
  enabled: boolean;
  failIfUnavailable: boolean;
  autoAllowBashIfSandboxed: boolean;
  filesystem: { allowWrite: string[]; allowRead?: string[] };
  network: { allowedDomains: string[]; allowLocalBinding?: boolean };
}

// Hosts the agent legitimately reaches while onboarding a tool (repo clone / package fetch).
const DEFAULT_ONBOARDING_DOMAINS = [
  "github.com", "raw.githubusercontent.com", "codeload.github.com",
  "objects.githubusercontent.com", "registry.npmjs.org",
  "pypi.org", "files.pythonhosted.org",
];

// The Anthropic API host used when no ANTHROPIC_BASE_URL override is set.
const DEFAULT_LLM_HOST = "api.anthropic.com";

/** Extracts the hostname from a URL, or null when it cannot be parsed. */
export function hostFromUrl(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/** True for loopback hosts — i.e. a local model gateway on this machine. */
function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
}

/** Resolves the sandbox policy from env + the vault root. Fail-closed unless GEODE_SANDBOX_DISABLE is set. */
export function resolveSandboxPolicy(env: Record<string, string | undefined>, vaultRoot: string): SandboxPolicy {
  const disabled = env.GEODE_SANDBOX_DISABLE === "1" || env.GEODE_SANDBOX_DISABLE === "true";
  const base = env.ANTHROPIC_BASE_URL ? hostFromUrl(env.ANTHROPIC_BASE_URL) : null;
  const llmHost = base ?? DEFAULT_LLM_HOST;
  const extra = (env.GEODE_AGENT_ALLOWED_DOMAINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowedDomains = Array.from(new Set([llmHost, ...DEFAULT_ONBOARDING_DOMAINS, ...extra]));
  return {
    enabled: !disabled,
    failIfUnavailable: true,
    allowWrite: [vaultRoot],
    allowedDomains,
    allowLocalBinding: isLoopback(llmHost),
  };
}

/** Builds the Agent SDK `sandbox` settings from the policy; undefined when disabled. `extraReadDirs` grants per-run read access (e.g. attachment staging). */
export function buildSandboxSettings(policy: SandboxPolicy | undefined, extraReadDirs: string[] = []): SandboxSettings | undefined {
  if (!policy || !policy.enabled) return undefined;
  return {
    enabled: true,
    failIfUnavailable: policy.failIfUnavailable,
    autoAllowBashIfSandboxed: true,
    filesystem: extraReadDirs.length
      ? { allowWrite: policy.allowWrite, allowRead: extraReadDirs }
      : { allowWrite: policy.allowWrite },
    network: policy.allowLocalBinding
      ? { allowedDomains: policy.allowedDomains, allowLocalBinding: true }
      : { allowedDomains: policy.allowedDomains },
  };
}

import { isAbsolute, resolve, sep } from "node:path";

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
  allowUnsandboxedCommands: boolean;
  filesystem: { allowWrite: string[]; allowRead?: string[] };
  network: { allowedDomains: string[]; allowLocalBinding?: boolean };
}

/** A single tool-call permission decision (mirrors the SDK's PermissionResult). */
export type ToolPermission = { behavior: "allow" } | { behavior: "deny"; message: string };

/** Non-interactive permission handler: decides each tool call without prompting (mirrors the SDK's CanUseTool). */
export type PermissionHandler = (toolName: string, input: Record<string, unknown>) => Promise<ToolPermission>;

// Tools that mutate the filesystem in the host process (outside the OS command sandbox that bounds
// Bash). These must be confined to the vault at the permission layer.
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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
    // The model must not opt a command out of the sandbox (Bash `dangerouslyDisableSandbox`).
    allowUnsandboxedCommands: false,
    filesystem: extraReadDirs.length
      ? { allowWrite: policy.allowWrite, allowRead: extraReadDirs }
      : { allowWrite: policy.allowWrite },
    network: policy.allowLocalBinding
      ? { allowedDomains: policy.allowedDomains, allowLocalBinding: true }
      : { allowedDomains: policy.allowedDomains },
  };
}

/** True when `target` (resolved against the first write root if relative) lands inside one of `roots`. */
function writeAllowed(target: string, roots: string[]): boolean {
  const base = roots[0] ?? "";
  const abs = isAbsolute(target) ? resolve(target) : resolve(base, target);
  return roots.some((root) => {
    const r = resolve(root);
    return abs === r || abs.startsWith(r + sep);
  });
}

/**
 * Builds the non-interactive permission handler that partners the OS sandbox. The sandbox bounds
 * Bash at the syscall level; this handler bounds the host-process tools the sandbox doesn't cover:
 * it denies network egress via WebFetch/WebSearch, refuses any Bash that opts out of the sandbox,
 * and confines file mutations to `writeRoots` (the vault). Everything else (reads, search, sandboxed
 * bash) is allowed. It never prompts — the vault agent runs without a human to answer mid-run.
 */
export function buildPermissionHandler(writeRoots: string[]): PermissionHandler {
  const deny = (message: string): ToolPermission => ({ behavior: "deny", message });
  return async (toolName, input) => {
    if (toolName === "Bash" && input.dangerouslyDisableSandbox === true) {
      return deny("running commands outside the sandbox is not permitted");
    }
    if (toolName === "WebFetch" || toolName === "WebSearch") {
      return deny(`${toolName} is disabled for the vault agent (network egress is off by default)`);
    }
    if (toolName === "AskUserQuestion") {
      return deny("interactive questions are disabled; state an assumption and proceed");
    }
    if (WRITE_TOOLS.has(toolName)) {
      const path = (input.file_path ?? input.notebook_path) as string | undefined;
      if (!path || !writeAllowed(path, writeRoots)) {
        return deny(`writes are confined to the vault; ${path ?? "(no path)"} is outside it`);
      }
    }
    return { behavior: "allow" };
  };
}

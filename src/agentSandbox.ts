import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseManifest } from "./tools.js";

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
  network: { allowedDomains: string[]; allowLocalBinding?: boolean; allowWebTools?: boolean };
}

/** A single tool-call permission decision (mirrors the SDK's PermissionResult). `allow` echoes the tool input back as `updatedInput` — the SDK's runtime schema requires it. */
export type ToolPermission = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string };

/** Non-interactive permission handler: decides each tool call without prompting (mirrors the SDK's CanUseTool). */
export type PermissionHandler = (toolName: string, input: Record<string, unknown>) => Promise<ToolPermission>;

// Tools that mutate the filesystem in the host process (outside the OS command sandbox that bounds
// Bash). These must be confined to the vault at the permission layer — canUseTool is their ONLY
// boundary. Must track the claude_code preset's host-process write tools: if the SDK adds a new
// file-mutating tool, add it here or it inherits the allow-by-default posture (see spec follow-ups).
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// Derived artifacts the agent must never hand-edit — the kernel regenerates them from the
// vault graph on every commit. Paths are vault-relative (POSIX separators).
const GENERATED_FILES = new Set(["index.md", ".geode/graph.json", "AGENTS.md"]);

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
      ? { allowedDomains: policy.allowedDomains, allowLocalBinding: true, allowWebTools: true }
      : { allowedDomains: policy.allowedDomains, allowWebTools: true },
  };
}

/**
 * Canonicalizes a path by realpath-ing its longest existing ancestor (the target file may not exist
 * yet) and re-appending the rest. This resolves symlinks — e.g. macOS `/var`→`/private/var`,
 * `/tmp`→`/private/tmp` — so a lexical prefix check compares like for like instead of falsely
 * rejecting a legitimate in-vault write.
 */
function canonicalPath(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return resolve(p);
    rest.unshift(basename(cur));
    cur = parent;
  }
  try { cur = realpathSync(cur); } catch { /* fall back to the resolved (non-symlink-followed) path */ }
  return rest.length ? join(cur, ...rest) : cur;
}

/** True when `target` (resolved against the first write root if relative) lands inside one of the already-canonicalized `roots`. */
function writeAllowed(target: string, roots: string[]): boolean {
  const base = roots[0] ?? "";
  const abs = canonicalPath(isAbsolute(target) ? target : join(base, target));
  return roots.some((r) => abs === r || abs.startsWith(r + sep));
}

/** Extracts `<id>` from a path ending in `tools/<id>/TOOL.md` (backslashes normalized to `/` first), or null if it isn't a tool manifest path. */
function manifestIdFromPath(path: string): string | null {
  const m = /(?:^|\/)tools\/([a-z0-9-]+)\/TOOL\.md$/.exec(path.replace(/\\/g, "/"));
  return m ? m[1] : null;
}

/**
 * Builds the non-interactive permission handler that partners the OS sandbox. The sandbox bounds
 * Bash at the syscall level; this handler bounds the host-process tools the sandbox doesn't cover:
 * it refuses any Bash that opts out of the sandbox and confines file mutations to `writeRoots` (the
 * vault). Network egress via WebFetch/WebSearch is gated by `allowWebTools` — false denies both
 * (e.g. for a librarian role confined to the model host), true allows them (e.g. a fetcher role).
 * Everything else (reads, search, sandboxed bash) is allowed. It never prompts — the vault agent
 * runs without a human to answer mid-run.
 */
export function buildPermissionHandler(writeRoots: string[], allowWebTools: boolean): PermissionHandler {
  const roots = writeRoots.map(canonicalPath);
  const deny = (message: string): ToolPermission => ({ behavior: "deny", message });
  return async (toolName, input) => {
    if (toolName === "Bash" && input.dangerouslyDisableSandbox === true) {
      return deny("running commands outside the sandbox is not permitted");
    }
    if (!allowWebTools && (toolName === "WebFetch" || toolName === "WebSearch")) {
      return deny(`${toolName} is disabled for this role (network is restricted to the model host)`);
    }
    if (toolName === "AskUserQuestion") {
      return deny("interactive questions are disabled; state an assumption and proceed");
    }
    if (WRITE_TOOLS.has(toolName)) {
      const path = input.file_path ?? input.notebook_path;
      if (typeof path !== "string" || !writeAllowed(path, roots)) {
        return deny(`writes are confined to the vault; ${typeof path === "string" ? path : "(no path)"} is outside it`);
      }
      const base = roots[0] ?? "";
      const rel = relative(base, canonicalPath(isAbsolute(path) ? path : join(base, path))).replace(/\\/g, "/");
      if (GENERATED_FILES.has(rel)) {
        const reason = rel === "AGENTS.md"
          ? `${rel} is the owner-controlled prompt overlay and is edited only via the dashboard, never by the agent`
          : `${rel} is generated from the vault graph and rebuilt automatically — do not edit it by hand`;
        return deny(reason);
      }
      // Full-file writes (only Write — Edit/MultiEdit don't hand us post-edit content) that land on a
      // tool manifest get validated against the same parser `loadTool` uses at run time, so a broken
      // TOOL.md is rejected with the real error immediately instead of surfacing later as "unknown tool".
      if (toolName === "Write") {
        const id = manifestIdFromPath(path);
        if (id && typeof input.content === "string") {
          try { parseManifest(id, input.content); }
          catch (e) { return deny(e instanceof Error ? e.message : String(e)); }
        }
      }
    }
    return { behavior: "allow", updatedInput: input };
  };
}

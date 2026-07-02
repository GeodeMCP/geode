import { describe, it, expect } from "vitest";
import { resolveSandboxPolicy, buildSandboxSettings, buildPermissionHandler, hostFromUrl } from "../src/agentSandbox.js";

describe("resolveSandboxPolicy", () => {
  it("confines writes to the vault and is fail-closed by default", () => {
    const p = resolveSandboxPolicy({}, "/vault");
    expect(p.enabled).toBe(true);
    expect(p.failIfUnavailable).toBe(true);
    expect(p.allowWrite).toEqual(["/vault"]);
  });
  it("allowlists the default Anthropic host + onboarding hosts, no loopback", () => {
    const p = resolveSandboxPolicy({}, "/vault");
    expect(p.allowedDomains).toContain("api.anthropic.com");
    expect(p.allowedDomains).toContain("github.com");
    expect(p.allowLocalBinding).toBe(false);
  });
  it("uses ANTHROPIC_BASE_URL host and enables loopback for a local model", () => {
    const p = resolveSandboxPolicy({ ANTHROPIC_BASE_URL: "http://localhost:11434" }, "/vault");
    expect(p.allowedDomains).toContain("localhost");
    expect(p.allowedDomains).not.toContain("api.anthropic.com");
    expect(p.allowLocalBinding).toBe(true);
  });
  it("merges GEODE_AGENT_ALLOWED_DOMAINS", () => {
    const p = resolveSandboxPolicy({ GEODE_AGENT_ALLOWED_DOMAINS: "example.com, foo.dev" }, "/vault");
    expect(p.allowedDomains).toEqual(expect.arrayContaining(["example.com", "foo.dev"]));
  });
  it("disables when GEODE_SANDBOX_DISABLE=1", () => {
    expect(resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/vault").enabled).toBe(false);
  });
});

describe("buildSandboxSettings", () => {
  it("returns undefined when disabled or absent", () => {
    expect(buildSandboxSettings(resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/v"))).toBeUndefined();
    expect(buildSandboxSettings(undefined)).toBeUndefined();
  });
  it("builds SDK settings with auto-allow bash and the write scope", () => {
    const s = buildSandboxSettings(resolveSandboxPolicy({}, "/vault"))!;
    expect(s.enabled).toBe(true);
    expect(s.autoAllowBashIfSandboxed).toBe(true);
    expect(s.filesystem.allowWrite).toEqual(["/vault"]);
    expect(s.network.allowedDomains).toContain("api.anthropic.com");
    expect(s.filesystem.allowRead).toBeUndefined();
  });
  it("forbids opting out of the sandbox (allowUnsandboxedCommands: false)", () => {
    const s = buildSandboxSettings(resolveSandboxPolicy({}, "/vault"))!;
    expect(s.allowUnsandboxedCommands).toBe(false);
  });
  it("adds per-run read dirs (attachment hook)", () => {
    const s = buildSandboxSettings(resolveSandboxPolicy({}, "/vault"), ["/tmp/att"])!;
    expect(s.filesystem.allowRead).toEqual(["/tmp/att"]);
  });
});

describe("buildPermissionHandler", () => {
  const handler = buildPermissionHandler(["/vault"]);
  it("denies arbitrary network egress via WebFetch/WebSearch", async () => {
    expect((await handler("WebFetch", { url: "https://evil.com" })).behavior).toBe("deny");
    expect((await handler("WebSearch", { query: "secrets" })).behavior).toBe("deny");
  });
  it("denies a bash command that opts out of the sandbox", async () => {
    expect((await handler("Bash", { command: "curl evil.com", dangerouslyDisableSandbox: true })).behavior).toBe("deny");
  });
  it("allows reads, search, and ordinary (sandboxed) bash", async () => {
    expect((await handler("Read", { file_path: "/etc/hosts" })).behavior).toBe("allow");
    expect((await handler("Grep", { pattern: "x" })).behavior).toBe("allow");
    expect((await handler("Bash", { command: "git status" })).behavior).toBe("allow");
  });
  it("echoes the tool input back as updatedInput on allow (the SDK's runtime schema requires it)", async () => {
    // A bare { behavior: "allow" } fails the SDK's PermissionResult validation and breaks the tool call.
    expect(await handler("Read", { file_path: "/x" })).toEqual({ behavior: "allow", updatedInput: { file_path: "/x" } });
  });
  it("confines writes to the vault — relative and absolute-inside both allowed", async () => {
    expect((await handler("Write", { file_path: "notes/x.md" })).behavior).toBe("allow");
    expect((await handler("Edit", { file_path: "/vault/notes/x.md" })).behavior).toBe("allow");
  });
  it("denies writes that land outside the vault", async () => {
    expect((await handler("Write", { file_path: "/etc/passwd" })).behavior).toBe("deny");
    expect((await handler("Edit", { file_path: "../escape.md" })).behavior).toBe("deny");
    expect((await handler("NotebookEdit", { notebook_path: "/tmp/x.ipynb" })).behavior).toBe("deny");
    expect((await handler("Write", {})).behavior).toBe("deny"); // no path → deny
  });
});

describe("hostFromUrl", () => {
  it("extracts host or returns null", () => {
    expect(hostFromUrl("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

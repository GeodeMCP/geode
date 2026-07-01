import { describe, it, expect } from "vitest";
import { resolveSandboxPolicy, buildSandboxSettings, hostFromUrl } from "../src/agentSandbox.js";

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
  it("adds per-run read dirs (attachment hook)", () => {
    const s = buildSandboxSettings(resolveSandboxPolicy({}, "/vault"), ["/tmp/att"])!;
    expect(s.filesystem.allowRead).toEqual(["/tmp/att"]);
  });
});

describe("hostFromUrl", () => {
  it("extracts host or returns null", () => {
    expect(hostFromUrl("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const handler = buildPermissionHandler(["/vault"], true);
  it("temporarily allows WebFetch/WebSearch (egress deny lifted — see issue #27)", async () => {
    expect((await handler("WebFetch", { url: "https://cloud.productflow.com/api" })).behavior).toBe("allow");
    expect((await handler("WebSearch", { query: "productflow api" })).behavior).toBe("allow");
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
    expect((await handler("MultiEdit", { file_path: "/etc/hosts" })).behavior).toBe("deny");
    expect((await handler("NotebookEdit", { notebook_path: "/tmp/x.ipynb" })).behavior).toBe("deny");
    expect((await handler("Write", {})).behavior).toBe("deny"); // no path → deny
    expect((await handler("Write", { file_path: 42 })).behavior).toBe("deny"); // non-string path → deny
  });
  it("denies hand-edits to generated artifacts (index.md, .geode/graph.json)", async () => {
    expect((await handler("Write", { file_path: "index.md" })).behavior).toBe("deny");
    expect((await handler("Edit", { file_path: "/vault/index.md" })).behavior).toBe("deny");
    expect((await handler("Write", { file_path: ".geode/graph.json" })).behavior).toBe("deny");
    expect((await handler("MultiEdit", { file_path: "/vault/.geode/graph.json" })).behavior).toBe("deny");
  });
  it("still allows writes to ordinary vault files", async () => {
    expect((await handler("Write", { file_path: "business/x.md" })).behavior).toBe("allow");
  });
});

describe("buildPermissionHandler tool-manifest write validation", () => {
  const handler = buildPermissionHandler(["/vault"], true);
  const VALID_TOOL_MD = `---
id: moneybird
name: Moneybird
type: http
description: Accounting API.
actions:
  list_invoices:
    http:
      method: GET
      url: https://api.moneybird.com/invoices
---
Body docs.
`;
  const INVALID_TOOL_MD = `---
id: moneybird
name: Moneybird
type: http
description: body = { "x": { "y": 1 } }
actions:
  list_invoices:
    http:
      method: GET
      url: https://api.moneybird.com/invoices
---
`;
  it("allows a Write of a valid TOOL.md in the vault", async () => {
    const res = await handler("Write", { file_path: "/vault/tools/moneybird/TOOL.md", content: VALID_TOOL_MD });
    expect(res.behavior).toBe("allow");
  });
  it("denies a Write of an invalid-YAML TOOL.md with the parser's error", async () => {
    const res = await handler("Write", { file_path: "/vault/tools/moneybird/TOOL.md", content: INVALID_TOOL_MD });
    expect(res.behavior).toBe("deny");
    expect((res as { message: string }).message).toMatch(/invalid TOOL\.md YAML frontmatter/);
  });
  it("denies a Write of a TOOL.md missing type/actions", async () => {
    const res = await handler("Write", { file_path: "/vault/tools/moneybird/TOOL.md", content: "---\nname: x\n---\n" });
    expect(res.behavior).toBe("deny");
    expect((res as { message: string }).message).toMatch(/needs type \+ actions/);
  });
  it("allows a Write of a non-manifest file regardless of content", async () => {
    const res = await handler("Write", { file_path: "/vault/notes/x.md", content: "not: valid: yaml: at: all: {" });
    expect(res.behavior).toBe("allow");
  });
  it("still denies a TOOL.md Write outside the vault — confinement runs before validation", async () => {
    const res = await handler("Write", { file_path: "/etc/tools/moneybird/TOOL.md", content: VALID_TOOL_MD });
    expect(res.behavior).toBe("deny");
    expect((res as { message: string }).message).toMatch(/confined to the vault/);
  });
});

describe("buildPermissionHandler symlink resolution (real filesystem)", () => {
  it("realpaths both sides: allows an in-vault write through a symlinked root, denies an escape via an in-vault symlink", async () => {
    const vault = mkdtempSync(join(tmpdir(), "geode-vault-"));
    const outside = mkdtempSync(join(tmpdir(), "geode-outside-"));
    symlinkSync(outside, join(vault, "escape")); // <vault>/escape -> /outside
    const handler = buildPermissionHandler([vault], true);
    // legit in-vault write — root canonicalization (e.g. macOS /var->/private/var) must not false-deny it
    expect((await handler("Write", { file_path: join(vault, "notes.md") })).behavior).toBe("allow");
    // write THROUGH an in-vault symlink whose target is outside the vault — must be denied
    expect((await handler("Write", { file_path: join(vault, "escape", "x.md") })).behavior).toBe("deny");
    rmSync(vault, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("allowWebTools gate", () => {
  it("denies WebFetch/WebSearch when allowWebTools is false", async () => {
    const h = buildPermissionHandler(["/v"], false);
    expect((await h("WebFetch", { url: "https://x" })).behavior).toBe("deny");
    expect((await h("WebSearch", { query: "x" })).behavior).toBe("deny");
  });
  it("allows WebFetch/WebSearch when allowWebTools is true", async () => {
    const h = buildPermissionHandler(["/v"], true);
    expect((await h("WebFetch", { url: "https://x" })).behavior).toBe("allow");
    expect((await h("WebSearch", { query: "x" })).behavior).toBe("allow");
  });
});

describe("hostFromUrl", () => {
  it("extracts host or returns null", () => {
    expect(hostFromUrl("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

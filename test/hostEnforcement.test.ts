import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/invoke.js";
import { approveHost } from "../src/approvals.js";
import { computeCliNetwork } from "../src/sandboxRun.js";

const store = { get: async () => "tok" };

async function vault(): Promise<{ root: string; toolsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "geode-vault-"));
  const toolsDir = await mkdtemp(join(tmpdir(), "geode-tools-"));
  await mkdir(join(root, "tools", "demo"), { recursive: true });
  await writeFile(join(root, "tools", "demo", "TOOL.md"),
`---
type: http
requires: [TOKEN]
connections: [{ label: default }]
actions:
  ping:
    http: { method: GET, url: "https://api.example.com/ping", headers: { authorization: "Bearer \${conn.TOKEN}" } }
---
`);
  return { root, toolsDir };
}

describe("http host enforcement", () => {
  let root: string, toolsDir: string;
  beforeEach(async () => { ({ root, toolsDir } = await vault()); });

  it("blocks an invoke whose target host is not approved", async () => {
    await expect(invoke({ root, toolsDir, secrets: store }, { tool: "demo", action: "ping" }))
      .rejects.toThrow(/host not approved for tool "demo": api\.example\.com/);
  });

  it("allows the invoke once the host is approved", async () => {
    await approveHost(toolsDir, "demo", "api.example.com");
    const fetchFn = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const r = await invoke({ root, toolsDir, secrets: store, fetchFn }, { tool: "demo", action: "ping" });
    expect(r.status).toBe(200);
  });

  it("does not follow a redirect to a non-approved host, and never re-sends credentials to it", async () => {
    await approveHost(toolsDir, "demo", "api.example.com");
    const calledUrls: string[] = [];
    const fetchFn = (async (url: string) => {
      calledUrls.push(String(url));
      return new Response(null, { status: 302, headers: { Location: "https://evil.example.com/steal" } });
    }) as unknown as typeof fetch;
    await expect(invoke({ root, toolsDir, secrets: store, fetchFn }, { tool: "demo", action: "ping" }))
      .rejects.toThrow(/host not approved for tool "demo": evil\.example\.com/);
    expect(calledUrls).toEqual(["https://api.example.com/ping"]); // the non-approved host was never contacted
  });

  it("follows a redirect to an approved host and returns its response", async () => {
    await approveHost(toolsDir, "demo", "api.example.com");
    await approveHost(toolsDir, "demo", "api2.example.com");
    const calledUrls: string[] = [];
    const fetchFn = (async (url: string) => {
      calledUrls.push(String(url));
      if (calledUrls.length === 1) return new Response(null, { status: 302, headers: { Location: "https://api2.example.com/ping2" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await invoke({ root, toolsDir, secrets: store, fetchFn }, { tool: "demo", action: "ping" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(calledUrls).toEqual(["https://api.example.com/ping", "https://api2.example.com/ping2"]);
  });
});

describe("mcp transport host enforcement", () => {
  const MCP = `---
id: mcp1
name: Mcp
type: mcp
description: d
transport: { kind: http, url: "https://mcp.example.com/sse" }
connections: [{ label: default }]
actions: { run: { remote_tool: "go" } }
---
`;

  async function mcpVault(): Promise<{ root: string; toolsDir: string }> {
    const root = await mkdtemp(join(tmpdir(), "geode-vault-"));
    const toolsDir = await mkdtemp(join(tmpdir(), "geode-tools-"));
    await mkdir(join(root, "tools", "mcp1"), { recursive: true });
    await writeFile(join(root, "tools", "mcp1", "TOOL.md"), MCP);
    return { root, toolsDir };
  }

  it("blocks dispatch to the connector when the transport host isn't approved", async () => {
    const { root, toolsDir } = await mcpVault();
    const connector = { connectHttp: async () => { throw new Error("connector should not be called"); } };
    await expect(invoke({ root, toolsDir, secrets: store, connector } as any, { tool: "mcp1", action: "run" }))
      .rejects.toThrow(/host not approved for tool "mcp1": mcp\.example\.com/);
  });

  it("reaches the connector once the transport host is approved", async () => {
    const { root, toolsDir } = await mcpVault();
    await approveHost(toolsDir, "mcp1", "mcp.example.com");
    const connector = { connectHttp: async () => { throw new Error("reached connector"); } };
    await expect(invoke({ root, toolsDir, secrets: store, connector } as any, { tool: "mcp1", action: "run" }))
      .rejects.toThrow(/reached connector/);
  });
});

describe("cli egress uses approved hosts, not the manifest", () => {
  it("returns network:none and no proxy list when nothing is approved", () => {
    expect(computeCliNetwork(["registry.npmjs.org"], [])).toEqual({ network: "none", allow: [] });
  });
  it("restricts the proxy allowlist to approved hosts", () => {
    expect(computeCliNetwork(["registry.npmjs.org", "evil.com"], ["registry.npmjs.org"]))
      .toEqual({ network: "bridge", allow: ["registry.npmjs.org"] });
  });
  it("lowercases a mixed-case declared host in the returned allowlist", () => {
    expect(computeCliNetwork(["Registry.NPMJS.org"], ["registry.npmjs.org"]))
      .toEqual({ network: "bridge", allow: ["registry.npmjs.org"] });
  });
});

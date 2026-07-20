import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/invoke.js";
import { approveHost } from "../src/approvals.js";

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
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { loadTool, listToolIds, resolveTemplate, connRef, resolveConnection } from "../src/tools.js";

function vault(): string { return mkdtempSync(join(tmpdir(), "geode-tools-")); }
function writeTool(root: string, id: string, md: string): void {
  mkdirSync(join(root, "tools", id), { recursive: true });
  writeFileSync(join(root, "tools", id, "TOOL.md"), md);
}

const HTTP = `---
id: linear
name: Linear
type: http
description: Create issues.
requires: [API_KEY]
connections:
  - { label: default }
actions:
  create_issue:
    params: [{ name: title, required: true }]
    http:
      method: POST
      url: https://api.linear.app/graphql
      headers: { Authorization: "Bearer \${conn.API_KEY}" }
---
Body docs here.
`;

const CLI = `---
id: gmail
name: Gmail
type: cli
description: Send email.
runtime: host
requires: [TOKEN]
source: { repo: "https://github.com/x/gog", ref: "v1" }
install: ["npm ci"]
bin: "./gog"
materialize: { inject: env, env: { GOG_TOKEN: "\${conn.TOKEN}" } }
connections:
  - { label: acme-sales, description: "Company B inbox" }
actions:
  send:
    params: [{ name: to, required: true }]
    command: ["send", "--to", "\${params.to}"]
---
`;

test("loadTool parses http frontmatter + body", async () => {
  const root = vault(); writeTool(root, "linear", HTTP);
  const t = await loadTool(root, "linear");
  expect(t.type).toBe("http");
  expect(t.requires).toEqual(["API_KEY"]);
  expect(t.actions.create_issue.http?.method).toBe("POST");
  expect(t.body?.trim()).toBe("Body docs here.");
});

test("loadTool parses cli frontmatter (source/install/bin/materialize/command)", async () => {
  const root = vault(); writeTool(root, "gmail", CLI);
  const t = await loadTool(root, "gmail");
  expect(t.type).toBe("cli");
  expect(t.runtime).toBe("host");
  expect(t.source?.repo).toContain("github.com");
  expect(t.bin).toBe("./gog");
  expect(t.actions.send.command).toEqual(["send", "--to", "${params.to}"]);
  expect(t.connections?.[0].label).toBe("acme-sales");
});

test("loadTool rejects a traversal id and a missing tool", async () => {
  const root = vault();
  await expect(loadTool(root, "../../etc")).rejects.toThrow(/invalid tool id/);
  await expect(loadTool(root, "nope")).rejects.toThrow();
});

test("listToolIds lists tool directories", async () => {
  const root = vault(); writeTool(root, "linear", HTTP); writeTool(root, "gmail", CLI);
  expect((await listToolIds(root)).sort()).toEqual(["gmail", "linear"]);
});

test("resolveTemplate fills params and conn, throws on unresolved", () => {
  const ctx = { params: { to: "josh" }, conn: { TOKEN: "abc" } };
  expect(resolveTemplate("send --to ${params.to} key=${conn.TOKEN}", ctx)).toBe("send --to josh key=abc");
  expect(() => resolveTemplate("${conn.MISSING}", ctx)).toThrow(/unresolved/);
});

test("connRef composes a flat secret ref", () => {
  expect(connRef("gmail", "acme-sales", "TOKEN")).toBe("gmail__acme-sales__TOKEN");
});

test("resolveConnection: explicit valid/invalid, single default, multi requires choice", () => {
  const one = [{ label: "default" }];
  const many = [{ label: "a" }, { label: "b" }];
  expect(resolveConnection(one, undefined)).toBe("default");
  expect(resolveConnection(many, "b")).toBe("b");
  expect(() => resolveConnection(many, "zzz")).toThrow(/not a connection/);
  expect(() => resolveConnection(many, undefined)).toThrow(/specify a connection/);
  expect(resolveConnection([], undefined)).toBeUndefined();
});

test("loadTool parses image, permissions and limits", async () => {
  const root = vault();
  writeTool(root, "cb", `---
id: cb
name: CB
type: cli
description: d
image: { base: "node:20-slim" }
permissions: { network: ["*.cloak.com"] }
limits: { timeoutMs: 30000, memoryMb: 256 }
source: { repo: "https://github.com/x/cb", ref: "v1" }
install: ["npm ci"]
bin: "./cb"
actions: { fetch: { command: ["fetch", "--url", "\${params.url}"], params: [{ name: url, required: true }] } }
---
`);
  const t = await loadTool(root, "cb");
  expect(t.image?.base).toBe("node:20-slim");
  expect(t.permissions?.network).toEqual(["*.cloak.com"]);
  expect(t.limits?.timeoutMs).toBe(30000);
});

test("loadTool rejects the old space-separated string command form", async () => {
  const root = vault();
  writeTool(root, "legacy", `---
id: legacy
name: Legacy
type: cli
description: d
actions: { fetch: { command: "fetch --url x" } }
---
`);
  await expect(loadTool(root, "legacy")).rejects.toThrow(/array of argv tokens/);
});

test("loadTool rejects an empty command array", async () => {
  const root = vault();
  writeTool(root, "empty", `---
id: empty
name: Empty
type: cli
description: d
actions: { fetch: { command: [] } }
---
`);
  await expect(loadTool(root, "empty")).rejects.toThrow(/array of argv tokens/);
});

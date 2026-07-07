import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { parseFrontmatter, deriveCapabilities } from "../src/capabilities.js";
import { createSecretStore, loadOrCreateKey } from "../src/secrets.js";

function vault() { return mkdtempSync(join(tmpdir(), "geode-cap-")); }
function store(dir: string) { return createSecretStore({ dir: join(dir, ".s"), key: loadOrCreateKey(join(dir, ".s")) }); }
function tool(root: string, id: string, md: string) { mkdirSync(join(root, "tools", id), { recursive: true }); writeFileSync(join(root, "tools", id, "TOOL.md"), md); }

const TOOL = `---
id: linear
name: Linear
type: http
description: Issues.
requires: [API_KEY]
connections: [{ label: default }]
actions: { create_issue: { http: { method: POST, url: "x" } } }
---
`;

test("parseFrontmatter still reads flat OKF fields", () => {
  expect(parseFrontmatter("---\ntype: sop\ntitle: T\n---\nx").type).toBe("sop");
});

test("deriveCapabilities lists tools (with connection status) and recipes", async () => {
  const root = vault(); tool(root, "linear", TOOL);
  writeFileSync(join(root, "r.md"), "---\ntype: sop\ntitle: Deploy\ndescription: how\n---\nbody");
  const s = store(root);
  const caps = await deriveCapabilities(root, s);
  expect(caps.tools[0].id).toBe("linear");
  expect(caps.tools[0].actions).toEqual(["create_issue"]);
  expect(caps.tools[0].connections[0]).toEqual({ label: "default", configured: false });
  await s.set("linear__default__API_KEY", "k");
  expect((await deriveCapabilities(root, s)).tools[0].connections[0].configured).toBe(true);
  expect(caps.recipes.map((r) => r.title)).toContain("Deploy");
});

test("deriveCapabilities on an empty vault returns empty lists", async () => {
  const root = vault();
  const caps = await deriveCapabilities(root, store(root));
  expect(caps.tools).toEqual([]); expect(caps.recipes).toEqual([]);
});

test("gaps (type: gap) surface under Planned / needed", async () => {
  const root = vault();
  mkdirSync(join(root, "backlog"), { recursive: true });
  writeFileSync(join(root, "backlog", "moneybird-tool.md"),
    "---\ntype: gap\nkind: tool\ntitle: Moneybird REST tool\ndescription: needed to book mutations\n---\nbody");
  const caps = await deriveCapabilities(root, store(root));
  expect(caps.gaps).toEqual([{ title: "Moneybird REST tool", kind: "tool", description: "needed to book mutations", path: "backlog/moneybird-tool.md" }]);
  expect(caps.text).toContain("## Planned / needed");
  expect(caps.text).toContain("[tool] Moneybird REST tool — needed to book mutations");
});

test("parseFrontmatter strips surrounding YAML quotes from scalar values", () => {
  const fm1 = parseFrontmatter('---\ntitle: "SOP: X"\ndescription: \'quoted desc\'\ntype: note\n---\nbody');
  expect(fm1.title).toBe("SOP: X");
  expect(fm1.description).toBe("quoted desc");
  expect(fm1.type).toBe("note");
});

test("parseFrontmatter leaves unquoted values unchanged", () => {
  const fm = parseFrontmatter('---\ntitle: Plain title\ndescription: unquoted description\n---\nbody');
  expect(fm.title).toBe("Plain title");
  expect(fm.description).toBe("unquoted description");
});

test("parseFrontmatter handles mixed quoted and unquoted fields", () => {
  const fm = parseFrontmatter('---\ntitle: "Quoted: title"\nstatus: active\nkind: \'single-quoted\'\n---\nbody');
  expect(fm.title).toBe("Quoted: title");
  expect(fm.status).toBe("active");
  expect(fm.kind).toBe("single-quoted");
});

test("parseFrontmatter does not strip quotes from array-like tags values", () => {
  const fm = parseFrontmatter('---\ntags: [a, b, c]\n---\nbody');
  expect(fm.tags).toEqual(["a", "b", "c"]);
});

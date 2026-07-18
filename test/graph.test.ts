import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { buildNodes, buildEdges, buildGraph, serializeGraph, writeGraph, GRAPH_PATH } from "../src/graph.js";

const noSecrets = { get: async () => null };

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-"));
  mkdirSync(join(root, "tools/moneybird"), { recursive: true });
  writeFileSync(join(root, "tools/moneybird/TOOL.md"),
    `---\nid: moneybird\nname: Moneybird\ntype: http\ndescription: MB\nconnections: [{ label: default }]\nactions: { list_mutations: { http: { method: GET, url: "https://x/m" } } }\n---\n`);
  mkdirSync(join(root, "notes/administratie"), { recursive: true });
  writeFileSync(join(root, "notes/administratie/sop-booking.md"),
    `---\ntype: sop\ntitle: SOP boeken\ndescription: boek\ntags: [administratie]\n---\nGebruik [[moneybird]].\n`);
  mkdirSync(join(root, "backlog"), { recursive: true });
  writeFileSync(join(root, "backlog/mb-attach.md"),
    `---\ntype: gap\nkind: tool\ntitle: MB attachment\ndescription: gap\ntags: [administratie]\n---\nBlokkeert [moneybird](../tools/moneybird/TOOL.md).\n`);
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "notes/decoy.md"),
    `---\ntype: reference\ntitle: Decoy\ndescription: "see [[moneybird]]"\n---\nNo links in body.\n`);
  return root;
}

test("buildNodes classifies tool, sop, gap with domain", async () => {
  const nodes = await buildNodes(fixture(), noSecrets);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  expect(byId["tools/moneybird"].type).toBe("tool");
  expect(byId["tools/moneybird"].actions).toContain("list_mutations");
  expect(byId["notes/administratie/sop-booking"]).toMatchObject({ type: "sop", domain: "administratie" });
  expect(byId["backlog/mb-attach"]).toMatchObject({ type: "gap", kind: "tool", count: 1 });
});

test("buildNodes excludes the AGENTS.md schema file (meta, not a capability)", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-agents-"));
  writeFileSync(join(root, "AGENTS.md"),
    `---\ntype: schema\ntitle: Vault schema\ndescription: conventions\n---\n# Vault schema\n`);
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "notes/real.md"),
    `---\ntype: reference\ntitle: Real\ndescription: r\n---\n`);
  const ids = (await buildNodes(root, noSecrets)).map((n) => n.id);
  expect(ids).toContain("notes/real");
  expect(ids).not.toContain("AGENTS");
});

test("domain comes from frontmatter (first tag), never from the notes/ path", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-dom-"));
  mkdirSync(join(root, "notes/administratie"), { recursive: true });
  // under notes/<X>/ but NO tags → must be ungrouped; the path must NOT supply a domain
  writeFileSync(join(root, "notes/administratie/bare.md"),
    `---\ntype: reference\ntitle: Bare\ndescription: no tags\n---\n`);
  // a free-form top-level folder WITH a tag → domain from the tag, path-independent
  mkdirSync(join(root, "business"), { recursive: true });
  writeFileSync(join(root, "business/plan.md"),
    `---\ntype: sop\ntitle: Plan\ndescription: p\ntags: [strategy]\n---\n`);
  const nodes = await buildNodes(root, noSecrets);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  expect(byId["notes/administratie/bare"].domain).toBe("");   // NOT "administratie" from the path
  expect(byId["business/plan"].domain).toBe("strategy");      // from the tag, anywhere in the tree
});

test("buildEdges types links from sop/gap to the moneybird tool", async () => {
  const root = fixture();
  const edges = await buildEdges(await buildNodes(root, noSecrets), root);
  expect(edges).toContainEqual({ from: "notes/administratie/sop-booking", to: "tools/moneybird", type: "uses" });
  expect(edges).toContainEqual({ from: "backlog/mb-attach", to: "tools/moneybird", type: "blocks" });
});

test("buildEdges ignores link-shaped text in frontmatter", async () => {
  const root = fixture();
  const edges = await buildEdges(await buildNodes(root, noSecrets), root);
  expect(edges).not.toContainEqual({ from: "notes/decoy", to: "tools/moneybird", type: "references" });
  expect(edges.filter((e) => e.from === "notes/decoy")).toHaveLength(0);
});

test("buildEdges normalizes a tool→sop link (a tool's 'Used by' section) to a sop→tool uses edge", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-tsop-"));
  mkdirSync(join(root, "tools/mb"), { recursive: true });
  writeFileSync(join(root, "tools/mb/TOOL.md"),
    `---\nid: mb\nname: MB\ntype: http\ndescription: MB\nconnections: [{ label: default }]\nactions: { a: { http: { method: GET, url: "https://x/a" } } }\n---\n## Used by\n- [SOP boeken](../../notes/sop-boeken.md)\n`);
  mkdirSync(join(root, "notes"), { recursive: true });
  writeFileSync(join(root, "notes/sop-boeken.md"),
    `---\ntype: sop\ntitle: SOP boeken\ndescription: boek\n---\nNo tool link in this SOP.\n`);
  const edges = await buildEdges(await buildNodes(root, noSecrets), root);
  // The relationship "SOP uses tool" is the same whichever file holds the link; the compiler
  // canonicalizes it to sop→tool `uses` so the graph doesn't depend on which file the librarian edited.
  expect(edges).toContainEqual({ from: "notes/sop-boeken", to: "tools/mb", type: "uses" });
  expect(edges).not.toContainEqual({ from: "tools/mb", to: "notes/sop-boeken", type: "references" });
});

test("buildGraph sorts nodes by id and edges by (from, type, to)", async () => {
  const graph = await buildGraph(fixture(), noSecrets);
  expect(graph.nodes.map((n) => n.id)).toEqual([
    "backlog/mb-attach",
    "notes/administratie/sop-booking",
    "notes/decoy",
    "tools/moneybird",
  ]);
  expect(graph.edges).toEqual([
    { from: "backlog/mb-attach", to: "tools/moneybird", type: "blocks" },
    { from: "notes/administratie/sop-booking", to: "tools/moneybird", type: "uses" },
  ]);
});

test("buildGraph is deterministic across runs on the same vault", async () => {
  const root = fixture();
  const first = await buildGraph(root, noSecrets);
  const second = await buildGraph(root, noSecrets);
  expect(second).toEqual(first);
});

test("serializeGraph produces byte-identical output for equal input", async () => {
  const graph = await buildGraph(fixture(), noSecrets);
  const a = serializeGraph(graph);
  const b = serializeGraph(graph);
  expect(a).toBe(b);
  expect(a.endsWith("\n")).toBe(true);
});

test("two independent builds of the same vault serialize byte-identically", async () => {
  const root = fixture();
  const a = serializeGraph(await buildGraph(root, noSecrets));
  const b = serializeGraph(await buildGraph(root, noSecrets));
  expect(a).toBe(b);
});

test("ambiguous [[wikilink]] resolves to the alphabetically-first matching id", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-"));
  // Created b before a: if resolution ever depended on directory-listing order
  // rather than a sort, this ordering would be the one to expose it.
  mkdirSync(join(root, "notes/b"), { recursive: true });
  writeFileSync(join(root, "notes/b/foo.md"), `---\ntype: reference\ntitle: Foo B\ndescription: b\n---\n`);
  mkdirSync(join(root, "notes/a"), { recursive: true });
  writeFileSync(join(root, "notes/a/foo.md"), `---\ntype: reference\ntitle: Foo A\ndescription: a\n---\n`);
  mkdirSync(join(root, "notes/c"), { recursive: true });
  writeFileSync(join(root, "notes/c/linker.md"), `---\ntype: reference\ntitle: Linker\ndescription: l\n---\nSee [[foo]].\n`);
  const nodes = await buildNodes(root, noSecrets);
  const edges = await buildEdges(nodes, root);
  expect(edges).toContainEqual({ from: "notes/c/linker", to: "notes/a/foo", type: "references" });
});

test("writeGraph persists the graph to .geode/graph.json, round-tripping via JSON", async () => {
  const root = fixture();
  const graph = await buildGraph(root, noSecrets);
  await writeGraph(root, graph);
  const raw = await readFile(join(root, GRAPH_PATH), "utf8");
  expect(JSON.parse(raw)).toEqual(graph);
});

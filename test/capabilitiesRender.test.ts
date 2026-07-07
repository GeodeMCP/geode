import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { renderCapabilities, loadGraph } from "../src/capabilitiesRender.js";
import type { VaultGraph } from "../src/graph.js";
import { GRAPH_PATH, serializeGraph } from "../src/graph.js";

function fixture(): VaultGraph {
  return {
    nodes: [
      {
        id: "backlog/mb-attach",
        type: "gap",
        title: "MB attachment",
        description: "gap",
        domain: "administratie",
        path: "backlog/mb-attach.md",
        kind: "tool",
        count: 1,
      },
      {
        id: "notes/administratie/sop-booking",
        type: "sop",
        title: "SOP boeken",
        description: "boek",
        domain: "administratie",
        path: "notes/administratie/sop-booking.md",
      },
      {
        id: "tools/moneybird",
        type: "tool",
        title: "Moneybird",
        description: "MB",
        domain: "administratie",
        path: "tools/moneybird/TOOL.md",
        actions: ["list_mutations", "link_booking"],
        connections: [{ label: "roverm", configured: false }],
      },
    ],
    edges: [
      { from: "notes/administratie/sop-booking", to: "tools/moneybird", type: "uses" },
      { from: "backlog/mb-attach", to: "tools/moneybird", type: "blocks" },
    ],
  };
}

test("renderCapabilities groups nodes under a domain heading", () => {
  const out = renderCapabilities(fixture());
  expect(out).toContain("## administratie");
});

test("renderCapabilities renders a tool node with state, actions, connections, used-by", () => {
  const out = renderCapabilities(fixture());
  expect(out).toContain('<tool id="tools/moneybird" state="needs-setup">');
  expect(out).toContain("actions: list_mutations, link_booking");
  expect(out).toContain("connections: roverm (needs setup)");
  expect(out).toContain("used-by: notes/administratie/sop-booking");
});

test("renderCapabilities renders a sop node's outgoing uses relationship", () => {
  const out = renderCapabilities(fixture());
  expect(out).toContain('<sop id="notes/administratie/sop-booking">');
  expect(out).toContain("uses: tools/moneybird");
});

test("renderCapabilities renders a gap node's kind/count attrs and blocks relationship", () => {
  const out = renderCapabilities(fixture());
  expect(out).toContain('<gap id="backlog/mb-attach" kind="tool" count="1">');
  expect(out).toContain("blocks: tools/moneybird");
});

test("renderCapabilities is deterministic", () => {
  const graph = fixture();
  expect(renderCapabilities(graph)).toEqual(renderCapabilities(graph));
});

test("renderCapabilities is deterministic across shuffled node order within same domain", () => {
  const graph1 = fixture();
  // Create graph2 with the same nodes but reordered within the same domain
  const graph2: VaultGraph = {
    nodes: [
      graph1.nodes[2], // tools/moneybird
      graph1.nodes[0], // backlog/mb-attach
      graph1.nodes[1], // notes/administratie/sop-booking
    ],
    edges: graph1.edges,
  };
  expect(renderCapabilities(graph1)).toEqual(renderCapabilities(graph2));
});

test("renderCapabilities guards undefined gap kind/count attributes", () => {
  const graph: VaultGraph = {
    nodes: [
      {
        id: "backlog/no-attrs",
        type: "gap",
        title: "Gap with no attrs",
        description: "no kind or count",
        domain: "test",
        path: "backlog/no-attrs.md",
        // kind and count intentionally omitted
      },
    ],
    edges: [],
  };
  const out = renderCapabilities(graph);
  // Should not contain "kind=" or "count=" or "undefined"
  expect(out).toContain('<gap id="backlog/no-attrs">');
  expect(out).not.toContain("kind=");
  expect(out).not.toContain("count=");
  expect(out).not.toContain("undefined");
});

test("renderCapabilities renders gap with kind and count when present", () => {
  const graph: VaultGraph = {
    nodes: [
      {
        id: "backlog/with-attrs",
        type: "gap",
        title: "Gap with attrs",
        description: "has kind and count",
        domain: "test",
        path: "backlog/with-attrs.md",
        kind: "tool",
        count: 2,
      },
    ],
    edges: [],
  };
  const out = renderCapabilities(graph);
  expect(out).toContain('<gap id="backlog/with-attrs" kind="tool" count="2">');
});

const noSecrets = { get: async () => null };

test("loadGraph reads and returns a parsed .geode/graph.json when it exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-cr-"));
  const graph = fixture();
  mkdirSync(join(root, ".geode"), { recursive: true });
  writeFileSync(join(root, GRAPH_PATH), serializeGraph(graph));

  const loaded = await loadGraph(root, noSecrets);
  expect(loaded).toEqual(graph);
});

test("loadGraph falls back to buildGraph when .geode/graph.json does not exist", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-cr-"));
  // Create a minimal fixture vault with one tool
  mkdirSync(join(root, "tools/test-tool"), { recursive: true });
  writeFileSync(join(root, "tools/test-tool/TOOL.md"),
    `---\nid: test-tool\nname: Test Tool\ntype: http\ndescription: Test\nconnections: []\nactions: { action1: { http: { method: GET, url: "https://x" } } }\n---\n`);

  const graph = await loadGraph(root, noSecrets);
  expect(graph.nodes).toHaveLength(1);
  expect(graph.nodes[0].id).toBe("tools/test-tool");
  expect(graph.nodes[0].type).toBe("tool");
  expect(graph.edges).toHaveLength(0);
});

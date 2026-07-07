import { test, expect } from "vitest";
import { renderCapabilities } from "../src/capabilitiesRender.js";
import type { VaultGraph } from "../src/graph.js";

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

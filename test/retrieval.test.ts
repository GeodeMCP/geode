import { test, expect } from "vitest";
import { selectSubgraph } from "../src/retrieval.js";
import type { VaultGraph } from "../src/graph.js";

function fixture(): VaultGraph {
  return {
    nodes: [
      {
        id: "notes/administratie/sop-booking",
        type: "sop",
        title: "SOP boeken",
        description: "boek bankmutaties",
        domain: "administratie",
        path: "notes/administratie/sop-booking.md",
      },
      {
        id: "notes/pricing",
        type: "reference",
        title: "Pricing",
        description: "standup",
        domain: "",
        path: "notes/pricing.md",
      },
      {
        id: "tools/moneybird",
        type: "tool",
        title: "Moneybird",
        description: "REST API voor boekhouding",
        domain: "administratie",
        path: "tools/moneybird/TOOL.md",
        actions: ["list_mutations", "link_booking"],
      },
    ],
    edges: [
      { from: "notes/administratie/sop-booking", to: "tools/moneybird", type: "uses" },
    ],
  };
}

test("selectSubgraph pulls in the matched sop and its 1-hop tool via the uses edge, excluding unrelated nodes", () => {
  const g = fixture();
  const result = selectSubgraph(g, "how do I book bankmutaties in moneybird");
  const ids = result.nodes.map((n) => n.id);
  expect(ids).toContain("notes/administratie/sop-booking");
  expect(ids).toContain("tools/moneybird");
  expect(ids).not.toContain("notes/pricing");
  expect(result.edges).toContainEqual({ from: "notes/administratie/sop-booking", to: "tools/moneybird", type: "uses" });
});

test("selectSubgraph returns an empty subgraph when no terms match", () => {
  const g = fixture();
  expect(selectSubgraph(g, "xyzzy qqq zzz")).toEqual({ nodes: [], edges: [] });
});

test("selectSubgraph is deterministic across repeated calls", () => {
  const g = fixture();
  const instruction = "how do I book bankmutaties in moneybird";
  expect(JSON.stringify(selectSubgraph(g, instruction))).toBe(JSON.stringify(selectSubgraph(g, instruction)));
});

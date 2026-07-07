import { test, expect } from "vitest";
import { selectSubgraph, renderScopedContext } from "../src/retrieval.js";
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

test("selectSubgraph expands 1-hop to include zero-score neighbours via edges", () => {
  const g: VaultGraph = {
    nodes: [
      {
        id: "notes/administratie/sop-widget",
        type: "sop",
        title: "Widget procedure",
        description: "step by step widget",
        domain: "administratie",
        path: "notes/administratie/sop-widget.md",
      },
      {
        id: "notes/zzz-alpha",
        type: "reference",
        title: "Alpha",
        description: "beta gamma",
        domain: "",
        path: "notes/zzz-alpha.md",
      },
      {
        id: "notes/qqq-omega",
        type: "reference",
        title: "Omega",
        description: "theta iota",
        domain: "",
        path: "notes/qqq-omega.md",
      },
    ],
    edges: [
      // Order matters: 2-hop edge processed before 1-hop edge prevents transitive closure in a single pass
      { from: "notes/zzz-alpha", to: "notes/qqq-omega", type: "uses" },
      { from: "notes/administratie/sop-widget", to: "notes/zzz-alpha", type: "uses" },
    ],
  };

  const result = selectSubgraph(g, "how do I execute the widget procedure");
  const ids = result.nodes.map((n) => n.id);

  // Entry node matches terms
  expect(ids).toContain("notes/administratie/sop-widget");

  // 1-hop neighbour (zero-score) is included via edge expansion
  expect(ids).toContain("notes/zzz-alpha");

  // 2-hop neighbour (zero-score) is excluded (beyond hops: 1)
  expect(ids).not.toContain("notes/qqq-omega");
});

test("renderScopedContext renders a path-first hint with relations and tool actions", () => {
  const g = fixture();
  const text = renderScopedContext(selectSubgraph(g, "how do I book in moneybird"));
  const sopLine = text.split("\n").find((l) => l.includes("notes/administratie/sop-booking.md"));
  const toolLine = text.split("\n").find((l) => l.includes("tools/moneybird/TOOL.md"));

  expect(sopLine).toBeDefined();
  expect(toolLine).toBeDefined();
  expect(sopLine).toContain("· uses tools/moneybird");
  expect(toolLine).toContain("· actions: list_mutations, link_booking");
});

test("renderScopedContext returns an empty string for an empty subgraph", () => {
  expect(renderScopedContext({ nodes: [], edges: [] })).toBe("");
});

test("renderScopedContext excludes incoming edges from a node's relations", () => {
  const g: VaultGraph = {
    nodes: [
      {
        id: "notes/onboarding/sop-setup",
        type: "sop",
        title: "Setup Guide",
        description: "initial setup instructions",
        domain: "onboarding",
        path: "notes/onboarding/sop-setup.md",
      },
      {
        id: "tools/github",
        type: "tool",
        title: "GitHub",
        description: "source control",
        domain: "",
        path: "tools/github/TOOL.md",
      },
    ],
    edges: [
      { from: "notes/onboarding/sop-setup", to: "tools/github", type: "uses" },
    ],
  };

  const text = renderScopedContext(g);
  const lines = text.split("\n");
  const sopLine = lines.find((l) => l.includes("notes/onboarding/sop-setup.md"));
  const toolLine = lines.find((l) => l.includes("tools/github/TOOL.md"));

  expect(sopLine).toBeDefined();
  expect(toolLine).toBeDefined();

  // Outgoing edge from sop to tool should appear in sop's line
  expect(sopLine).toContain("· uses tools/github");

  // Incoming edge to tool should NOT appear in tool's line (no outgoing edges from tool)
  expect(toolLine).not.toContain("· uses");
});

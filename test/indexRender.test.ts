import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { renderIndex, writeIndex } from "../src/indexRender.js";
import type { VaultGraph } from "../src/graph.js";

function fixture(): VaultGraph {
  return {
    nodes: [
      {
        id: "notes/administratie/overview",
        type: "reference",
        title: "Administratie — overzicht",
        description: "domein-ingang",
        domain: "administratie",
        path: "notes/administratie/overview.md",
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
        description: "Moneybird REST API",
        domain: "",
        path: "tools/moneybird/TOOL.md",
      },
    ],
    edges: [],
  };
}

test("renderIndex starts with the exact frontmatter block", () => {
  const out = renderIndex(fixture());
  expect(out.startsWith("---\ntype: index\n")).toBe(true);
});

test("renderIndex contains the # Index heading", () => {
  const out = renderIndex(fixture());
  expect(out).toContain("# Index");
});

test("renderIndex groups domain nodes under their domain heading, before (ungrouped)", () => {
  const out = renderIndex(fixture());
  expect(out).toContain("## administratie");
  expect(out).toContain("## (ungrouped)");
  expect(out.indexOf("## administratie")).toBeLessThan(out.indexOf("## (ungrouped)"));
});

test("renderIndex renders exact node lines with title, path, description", () => {
  const out = renderIndex(fixture());
  expect(out).toContain("- [SOP boeken](notes/administratie/sop-booking.md) — boek");
  expect(out).toContain("- [Administratie — overzicht](notes/administratie/overview.md) — domein-ingang");
  expect(out).toContain("- [Moneybird](tools/moneybird/TOOL.md) — Moneybird REST API");
});

test("renderIndex is deterministic", () => {
  const graph = fixture();
  expect(renderIndex(graph)).toBe(renderIndex(graph));
});

test("renderIndex on an empty graph has no domain section headers", () => {
  const out = renderIndex({ nodes: [], edges: [] });
  expect(out).toContain("# Index");
  expect(out).not.toContain("##");
});

test("writeIndex writes index.md equal to renderIndex", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-index-"));
  const graph = fixture();
  await writeIndex(root, graph);
  const written = await readFile(join(root, "index.md"), "utf8");
  expect(written).toBe(renderIndex(graph));
});

test("renderIndex preserves intra-domain node order from graph.nodes array (not sorted by id)", () => {
  const graph: VaultGraph = {
    nodes: [
      {
        id: "notes/x/zzz",
        type: "reference",
        title: "Zzz",
        description: "z",
        domain: "x",
        path: "notes/x/zzz.md",
      },
      {
        id: "notes/x/aaa",
        type: "reference",
        title: "Aaa",
        description: "a",
        domain: "x",
        path: "notes/x/aaa.md",
      },
    ],
    edges: [],
  };
  const out = renderIndex(graph);
  const zzzIndex = out.indexOf("[Zzz]");
  const aaaIndex = out.indexOf("[Aaa]");
  expect(zzzIndex).toBeLessThan(aaaIndex);
});

test("renderIndex omits em-dash tail when description is empty", () => {
  const graph: VaultGraph = {
    nodes: [
      {
        id: "notes/y/n",
        type: "reference",
        title: "NoDesc",
        description: "",
        domain: "y",
        path: "notes/y/n.md",
      },
    ],
    edges: [],
  };
  const out = renderIndex(graph);
  expect(out).toContain("- [NoDesc](notes/y/n.md)");
  expect(out).not.toContain("- [NoDesc](notes/y/n.md) —");
});

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GraphNode, VaultGraph } from "./graph.js";

/** Renders a single node as a catalog line, omitting the description tail when it's empty. */
function renderNode(node: GraphNode): string {
  const tail = node.description ? ` — ${node.description}` : "";
  return `- [${node.title}](${node.path})${tail}`;
}

/**
 * Renders a capability graph as `index.md`'s human-readable catalog: a fixed frontmatter
 * block and heading, then one `## <domain>` section per domain (sorted ascending, with
 * nodes lacking a domain grouped last under `## (ungrouped)`), each listing its nodes in
 * `graph.nodes` order. Output is deterministic for a given graph.
 */
export function renderIndex(graph: VaultGraph): string {
  const byDomain = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (!byDomain.has(node.domain)) byDomain.set(node.domain, []);
    byDomain.get(node.domain)!.push(node);
  }
  const domains = [...byDomain.keys()].filter((d) => d !== "").sort();
  if (byDomain.has("")) domains.push("");

  const lines: string[] = [
    "---",
    "type: index",
    "title: Index",
    "description: Generated catalog of the vault — do not edit by hand.",
    "---",
    "",
    "# Index",
    "",
    "Generated from the vault's capability graph — do not edit by hand; it is rebuilt on every change.",
  ];
  for (const domain of domains) {
    lines.push("", `## ${domain === "" ? "(ungrouped)" : domain}`);
    for (const node of byDomain.get(domain)!) lines.push(renderNode(node));
  }
  return lines.join("\n") + "\n";
}

/** Writes the rendered catalog to `index.md` under `root`. */
export async function writeIndex(root: string, graph: VaultGraph): Promise<void> {
  await writeFile(join(root, "index.md"), renderIndex(graph));
}

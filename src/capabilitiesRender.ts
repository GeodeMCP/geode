import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretStore } from "./secrets.js";
import type { EdgeType, GraphEdge, GraphNode, VaultGraph } from "./graph.js";
import { buildGraph, GRAPH_PATH } from "./graph.js";

const OUTGOING_ORDER: EdgeType[] = ["uses", "references", "blocks"];

/** Renders the open tag (with type-specific attributes) for a single node's XML block. */
function renderOpenTag(node: GraphNode): string {
  const attrs = [`id="${node.id}"`];
  if (node.type === "tool") {
    const ok = (node.connections ?? []).every((c) => c.configured);
    attrs.push(`state="${ok ? "ok" : "needs-setup"}"`);
  }
  if (node.type === "gap") {
    if (node.kind !== undefined) attrs.push(`kind="${node.kind}"`);
    if (node.count !== undefined) attrs.push(`count="${node.count}"`);
  }
  return `<${node.type} ${attrs.join(" ")}>`;
}

/** Derives the fixed-order relationship body lines (outgoing by type, incoming uses → used-by) for a node. */
function renderRelationships(id: string, edges: GraphEdge[]): string[] {
  const lines: string[] = [];
  for (const type of OUTGOING_ORDER) {
    const targets = edges.filter((e) => e.from === id && e.type === type).map((e) => e.to).sort();
    if (targets.length) lines.push(`${type}: ${targets.join(", ")}`);
  }
  const usedBy = edges.filter((e) => e.to === id && e.type === "uses").map((e) => e.from).sort();
  if (usedBy.length) lines.push(`used-by: ${usedBy.join(", ")}`);
  return lines;
}

/** Renders a single node as an XML-fenced block (open tag, body lines, close tag) followed by a blank line. */
function renderNode(node: GraphNode, edges: GraphEdge[]): string[] {
  const body: string[] = [];
  if (node.description) body.push(node.description);
  if (node.type === "tool" && node.actions?.length) body.push(`actions: ${node.actions.join(", ")}`);
  if (node.type === "tool" && node.connections?.length) {
    body.push(`connections: ${node.connections.map((c) => `${c.label} (${c.configured ? "ok" : "needs setup"})`).join(", ")}`);
  }
  body.push(...renderRelationships(node.id, edges));
  return [renderOpenTag(node), ...body, `</${node.type}>`, ""];
}

/**
 * Renders a capability graph as domain-grouped, XML-fenced structured markdown: a `# Capabilities`
 * heading, then one `## <domain>` section per domain (sorted ascending, with nodes lacking a
 * domain grouped last under `## (ungrouped)`), each containing its nodes as XML blocks sorted by
 * `id` ascending. Output is deterministic for a given graph.
 */
export function renderCapabilities(graph: VaultGraph): string {
  const byDomain = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (!byDomain.has(node.domain)) byDomain.set(node.domain, []);
    byDomain.get(node.domain)!.push(node);
  }
  const domains = [...byDomain.keys()].filter((d) => d !== "").sort();
  if (byDomain.has("")) domains.push("");

  const lines: string[] = ["# Capabilities", ""];
  for (const domain of domains) {
    lines.push(`## ${domain === "" ? "(ungrouped)" : domain}`, "");
    const nodes = byDomain.get(domain)!.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const node of nodes) lines.push(...renderNode(node, graph.edges));
  }
  return lines.join("\n");
}

/**
 * Loads a capability graph from disk, returning the parsed `.geode/graph.json` if it exists,
 * otherwise builds and returns the graph for the vault.
 */
export async function loadGraph(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultGraph> {
  try {
    return JSON.parse(await readFile(join(root, GRAPH_PATH), "utf8")) as VaultGraph;
  } catch {
    return buildGraph(root, secrets);
  }
}

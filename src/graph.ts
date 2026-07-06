import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parseFrontmatter } from "./capabilities.js";
import { listToolIds, loadTool, connectionConfigured } from "./tools.js";
import type { SecretStore } from "./secrets.js";

/** Classified node type in the capability graph. */
export type NodeType = "tool" | "reference" | "sop" | "gap";
/** Directed edge type connecting nodes in the capability graph. */
export type EdgeType = "uses" | "references" | "blocks";

/** A typed node representing a capability (tool, recipe, SOP, or gap) in the vault. */
export interface GraphNode {
  id: string;                 // vault-relative, extension-stripped: "tools/moneybird", "notes/administratie/overview"
  type: NodeType;
  title: string;
  description: string;
  domain: string;             // grouping; "" when ungrouped
  path: string;               // source file, vault-relative
  actions?: string[];         // tool only
  connections?: { label: string; configured: boolean }[]; // tool only
  kind?: string;              // gap only
  count?: number;             // gap only (v1: 1)
}

/** A directed edge between two nodes in the capability graph. */
export interface GraphEdge { from: string; to: string; type: EdgeType }

/** A complete capability graph for a vault, containing all typed nodes and directed edges. */
export interface VaultGraph { nodes: GraphNode[]; edges: GraphEdge[] }

const SKIP_DIRS = new Set([".git", "node_modules", "artifacts", ".geode", "tools"]);
const SKIP_FILES = new Set(["index.md", "log.md"]);

/** Collects vault-relative markdown paths (POSIX slashes), skipping generated/tool dirs. */
async function walkMd(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walkMd(root, join(dir, e.name), out);
    } else if (e.name.endsWith(".md") && !SKIP_FILES.has(e.name)) {
      out.push(relative(root, join(dir, e.name)).split(sep).join("/"));
    }
  }
}

const nodeType = (t?: string): NodeType | null =>
  t === "gap" ? "gap" : t === "recipe" || t === "skill" || t === "sop" ? "sop" : t ? "reference" : null;

/**
 * Extracts typed capability nodes (tools + typed markdown concepts) from the vault.
 */
export async function buildNodes(root: string, secrets: Pick<SecretStore, "get">): Promise<GraphNode[]> {
  const nodes: GraphNode[] = [];
  for (const id of await listToolIds(root)) {
    try {
      const m = await loadTool(root, id);
      const connections = [];
      for (const c of m.connections ?? []) {
        connections.push({ label: c.label, configured: await connectionConfigured(secrets, m.id, c.label, m.requires ?? []) });
      }
      nodes.push({ id: `tools/${m.id}`, type: "tool", title: m.name, description: m.description, domain: "", path: `tools/${m.id}/TOOL.md`, actions: Object.keys(m.actions), connections });
    } catch {
      /* skip malformed */
    }
  }
  const files: string[] = [];
  await walkMd(root, root, files);
  for (const rel of files) {
    const fm = parseFrontmatter(await readFile(join(root, rel), "utf8").catch(() => ""));
    const type = nodeType(fm.type);
    if (!type) continue;
    const domain = fm.tags?.[0] ?? (rel.startsWith("notes/") && rel.split("/").length > 2 ? rel.split("/")[1] : "");
    const node: GraphNode = { id: rel.replace(/\.md$/, ""), type, title: fm.title ?? rel, description: fm.description ?? "", domain, path: rel };
    if (type === "gap") {
      node.kind = fm.kind;
      node.count = 1;
    }
    nodes.push(node);
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return nodes;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const MDLINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/** Resolves a `[[name]]` wikilink to a node id: a suffix match on `/name`. */
function resolveWikilink(nodes: GraphNode[], name: string): string | undefined {
  return nodes.find((n) => n.id.endsWith(`/${name}`))?.id;
}

/** Resolves a relative markdown link `href` against the linking node's file dir to a node id. */
function resolveRelativeLink(nodePath: string, href: string): string {
  const joined = join(dirname(nodePath), href).split(sep).join("/");
  return joined.replace(/\.md$/, "").replace(/\/TOOL$/, "");
}

/**
 * Derives typed edges from `[[wikilinks]]` and relative markdown links found in each node's file.
 */
export async function buildEdges(nodes: GraphNode[], root: string): Promise<GraphEdge[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const raw = await readFile(join(root, node.path), "utf8").catch(() => "");
    const body = raw.replace(/^---\n[\s\S]*?\n---/, "");
    const targets = new Set<string>();
    for (const m of body.matchAll(WIKILINK_RE)) {
      const to = resolveWikilink(nodes, m[1].trim());
      if (to) targets.add(to);
    }
    for (const m of body.matchAll(MDLINK_RE)) {
      const to = resolveRelativeLink(node.path, m[1].trim());
      if (byId.has(to)) targets.add(to);
    }
    for (const to of targets) {
      const target = byId.get(to);
      const type: EdgeType = node.type === "gap" ? "blocks" : node.type === "sop" && target?.type === "tool" ? "uses" : "references";
      const key = `${node.id}|${type}|${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: node.id, to, type });
    }
  }
  return edges;
}

/**
 * Builds the complete capability graph for a vault: nodes and edges, deterministically
 * ordered so repeated runs over the same vault produce deep-equal output.
 */
export async function buildGraph(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultGraph> {
  const nodes = await buildNodes(root, secrets);
  const edges = await buildEdges(nodes, root);
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return 0;
  });
  return { nodes, edges };
}

/** Vault-relative path where the compiled capability graph is persisted. */
export const GRAPH_PATH = ".geode/graph.json";

/**
 * Serializes a `VaultGraph` to deterministic JSON: fresh object literals with a fixed
 * field order (independent of insertion order in the source objects), pretty-printed,
 * with a trailing newline.
 */
export function serializeGraph(g: VaultGraph): string {
  const nodes = g.nodes.map((n) => {
    const out: GraphNode = {
      id: n.id,
      type: n.type,
      title: n.title,
      description: n.description,
      domain: n.domain,
      path: n.path,
    };
    if (n.actions !== undefined) out.actions = n.actions;
    if (n.connections !== undefined) out.connections = n.connections;
    if (n.kind !== undefined) out.kind = n.kind;
    if (n.count !== undefined) out.count = n.count;
    return out;
  });
  const edges = g.edges.map((e) => ({ from: e.from, type: e.type, to: e.to }));
  return JSON.stringify({ nodes, edges }, null, 2) + "\n";
}

/** Writes the serialized capability graph to `GRAPH_PATH` under `root`, creating `.geode` if needed. */
export async function writeGraph(root: string, g: VaultGraph): Promise<void> {
  await mkdir(dirname(join(root, GRAPH_PATH)), { recursive: true });
  await writeFile(join(root, GRAPH_PATH), serializeGraph(g));
}

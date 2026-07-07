import type { GraphNode, VaultGraph } from "./graph.js";

const STOPWORDS = new Set([
  "the", "and", "for", "how", "use", "using", "get", "can", "you", "your",
  "with", "what", "which", "from", "this", "that", "are", "was", "does", "run",
  "hoe", "wat", "met", "kan", "een", "het", "mijn", "voor", "van", "ophalen", "laatste",
]);

/** Tokenizes an instruction into lowercase terms of length ≥ 3, dropping stopwords and duplicates. */
function tokenize(instruction: string): string[] {
  const raw = instruction.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of raw) {
    if (t.length < 3 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
  }
  return terms;
}

/** Builds the lowercase searchable text for a node: id, title, description, domain, and actions. */
function searchable(node: GraphNode): string {
  return `${node.id} ${node.title} ${node.description} ${node.domain} ${(node.actions ?? []).join(" ")}`.toLowerCase();
}

/** Counts how many of the given terms appear in the node's searchable text. */
function score(node: GraphNode, terms: string[]): number {
  const text = searchable(node);
  let n = 0;
  for (const t of terms) if (text.includes(t)) n++;
  return n;
}

/**
 * Selects a scoped subgraph relevant to a natural-language instruction: scores nodes by
 * term overlap, takes the top-scoring entry nodes, then expands outward across edges for
 * `opts.hops` passes. Returns the induced subgraph (nodes + edges among selected nodes),
 * preserving the input graph's existing order for deterministic output.
 */
export function selectSubgraph(graph: VaultGraph, instruction: string, opts?: { entries?: number; hops?: number }): VaultGraph {
  const terms = tokenize(instruction);
  const entries = opts?.entries ?? 6;
  const hops = opts?.hops ?? 1;

  const scored = graph.nodes
    .map((n) => ({ id: n.id, score: score(n, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const selected = new Set(scored.slice(0, entries).map((s) => s.id));

  for (let i = 0; i < hops; i++) {
    for (const e of graph.edges) {
      if (selected.has(e.from)) selected.add(e.to);
      else if (selected.has(e.to)) selected.add(e.from);
    }
  }

  return {
    nodes: graph.nodes.filter((n) => selected.has(n.id)),
    edges: graph.edges.filter((e) => selected.has(e.from) && selected.has(e.to)),
  };
}

/** Truncates a string to at most `n` characters, appending an ellipsis when trimmed. */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const REL_TYPE_ORDER = ["uses", "references", "blocks"] as const;

/** Renders a node's outgoing edges, grouped by type in a fixed order, e.g. " · uses a, b · blocks c". */
function renderRelations(nodeId: string, edges: VaultGraph["edges"]): string {
  let out = "";
  for (const type of REL_TYPE_ORDER) {
    const targets = edges.filter((e) => e.from === nodeId && e.type === type).map((e) => e.to).sort();
    if (targets.length > 0) out += ` · ${type} ${targets.join(", ")}`;
  }
  return out;
}

/**
 * Renders a scoped subgraph as a compact, path-first navigation hint for the desk: a header
 * followed by one line per node (in the subgraph's order) with its path, type, title, a
 * truncated description, its outgoing relations grouped by edge type, and tool actions.
 * Returns "" when the subgraph has no nodes.
 */
export function renderScopedContext(sub: VaultGraph): string {
  if (sub.nodes.length === 0) return "";

  const header =
    "Relevant vault capabilities for this request (pre-selected from the capability graph — start here and read these files as needed instead of scanning the whole vault; if none fit, consult index.md):";

  const lines = sub.nodes.map((node) => {
    const rels = renderRelations(node.id, sub.edges);
    const actions =
      node.type === "tool" && node.actions && node.actions.length > 0
        ? ` · actions: ${node.actions.join(", ")}`
        : "";
    return `- ${node.path} — ${node.type}: ${node.title}. ${truncate(node.description, 160)}${rels}${actions}`;
  });

  return [header, ...lines].join("\n");
}

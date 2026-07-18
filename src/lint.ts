import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { buildGraph, type VaultGraph } from "./graph.js";
import type { SecretStore } from "./secrets.js";

/** One page that still uses `[[wikilink]]` syntax instead of the vault's canonical relative markdown links. */
export interface StrayWikilink { path: string; count: number }

/** A relative markdown link whose target file does not exist on disk. */
export interface BrokenLink { path: string; link: string }

/** A reference|sop node with no edges — unreachable via the capability graph. */
export interface OrphanNode { id: string; path: string }

/** Aggregated deterministic health findings for a vault. */
export interface VaultHealth {
  strayWikilinks: StrayWikilink[];
  orphans: OrphanNode[];
  brokenLinks: BrokenLink[];
}

const SKIP_DIRS = new Set([".git", "node_modules", ".geode", "artifacts"]);
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

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
    } else if (e.name.endsWith(".md")) {
      out.push(relative(root, join(dir, e.name)).split(sep).join("/"));
    }
  }
}

/**
 * Scans the vault for pages still using `[[wikilink]]` syntax (which the vault treats as legacy — links
 * should be resolvable relative markdown links). Returns vault-relative paths with a positive count,
 * sorted by path. Skips `.git`, `node_modules`, `.geode`, and `artifacts`.
 */
export async function findStrayWikilinks(root: string): Promise<StrayWikilink[]> {
  const files: string[] = [];
  await walkMd(root, root, files);
  const out: StrayWikilink[] = [];
  for (const path of files) {
    const content = await readFile(join(root, path), "utf8");
    const count = content.match(WIKILINK_RE)?.length ?? 0;
    if (count > 0) out.push({ path, count });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

const MDLINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Scans the vault for relative markdown links whose target file does not exist on disk.
 * Skips links with a URL scheme (http:, https:, mailto:, …), pure `#anchor` links, and
 * absolute (`/`-rooted) links. Returns vault-relative paths and the original link text,
 * deduped per (path, link) and sorted by path then link.
 */
export async function findBrokenLinks(root: string): Promise<BrokenLink[]> {
  const files: string[] = [];
  await walkMd(root, root, files);
  const out: BrokenLink[] = [];
  const seen = new Set<string>();
  for (const page of files) {
    const raw = await readFile(join(root, page), "utf8");
    const content = raw.replace(/^---\n[\s\S]*?\n---/, "");
    for (const m of content.matchAll(MDLINK_RE)) {
      const href = m[1].trim();
      if (SCHEME_RE.test(href) || href.startsWith("#") || href.startsWith("/")) continue;
      const stripped = href.split("#")[0];
      if (!stripped) continue;
      const target = join(dirname(join(root, page)), stripped);
      try {
        await stat(target);
      } catch {
        const key = `${page}|${href}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path: page, link: href });
      }
    }
  }
  out.sort((a, b) => (a.path !== b.path ? (a.path < b.path ? -1 : 1) : a.link < b.link ? -1 : a.link > b.link ? 1 : 0));
  return out;
}

/**
 * Flags `reference`|`sop` graph nodes that appear in no edge — unreachable via the
 * capability graph. `tool` and `gap` nodes are excluded: a freshly-added tool no SOP uses
 * yet, and a gap, are legitimately unlinked. Sorted by id.
 */
export function findOrphanNodes(graph: VaultGraph): OrphanNode[] {
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    linked.add(edge.from);
    linked.add(edge.to);
  }
  const out: OrphanNode[] = [];
  for (const node of graph.nodes) {
    if ((node.type === "reference" || node.type === "sop") && !linked.has(node.id)) {
      out.push({ id: node.id, path: node.path });
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Runs the full deterministic health pass over a vault: stray wikilinks, orphan graph
 * nodes, and broken relative markdown links.
 */
export async function lintVault(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultHealth> {
  const graph = await buildGraph(root, secrets);
  const [strayWikilinks, brokenLinks] = await Promise.all([findStrayWikilinks(root), findBrokenLinks(root)]);
  return { strayWikilinks, orphans: findOrphanNodes(graph), brokenLinks };
}

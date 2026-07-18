import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** One page that still uses `[[wikilink]]` syntax instead of the vault's canonical relative markdown links. */
export interface StrayWikilink { path: string; count: number }

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

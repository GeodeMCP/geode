import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Represents a single node in the workspace file tree, either a file or a directory with optional children. */
export interface TreeNode { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] }

const HIDDEN = new Set([".git", "integrations", "artifacts", ".gitignore", "node_modules"]);

/** Recursively reads the workspace directory and returns a sorted tree of files and folders, excluding hidden/system entries. */
export async function buildKnowledgeTree(root: string, rel = ""): Promise<TreeNode[]> {
  const dir = rel ? join(root, rel) : root;
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (rel === "" && HIDDEN.has(e.name)) continue;
    if (e.name.startsWith(".")) continue;
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path, type: "dir", children: await buildKnowledgeTree(root, path) });
    } else {
      nodes.push({ name: e.name, path, type: "file" });
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return nodes;
}

/** git status --porcelain → {modified, created}. "??"/"A" = created; everything else with a path = modified. */
export function parseStatus(porcelain: string): { modified: string[]; created: string[] } {
  const modified: string[] = [], created: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    const norm = line.length < 3 || line[2] !== " " ? " " + line : line;
    const code = norm.slice(0, 2), path = norm.slice(3);
    if (code === "??" || code[0] === "A") created.push(path);
    else modified.push(path);
  }
  return { modified, created };
}

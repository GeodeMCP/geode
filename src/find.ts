import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface FindArgs {
  path?: string;
  query?: string;
  maxResults?: number;
}

export type FindResult =
  | { kind: "list"; entries: string[] }
  | { kind: "read"; content: string }
  | { kind: "search"; hits: { path: string; line: string }[] };

function safeResolve(root: string, p: string): string {
  const target = resolve(root, p);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path is outside workspace: ${p}`);
  }
  return target;
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, root, out);
    else out.push(relative(root, full));
  }
}

export async function find(root: string, args: FindArgs): Promise<FindResult> {
  const max = args.maxResults ?? 50;

  if (args.query) {
    const files: string[] = [];
    await walk(safeResolve(root, args.path ?? "."), root, files);
    const hits: { path: string; line: string }[] = [];
    for (const rel of files) {
      const text = await readFile(join(root, rel), "utf8").catch(() => "");
      for (const line of text.split("\n")) {
        if (line.toLowerCase().includes(args.query.toLowerCase())) {
          hits.push({ path: rel, line: line.trim() });
          if (hits.length >= max) return { kind: "search", hits };
        }
      }
    }
    return { kind: "search", hits };
  }

  const target = safeResolve(root, args.path ?? ".");
  const st = await stat(target);
  if (st.isDirectory()) {
    const entries = (await readdir(target, { withFileTypes: true }))
      .filter((e) => e.name !== ".git")
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return { kind: "list", entries };
  }
  return { kind: "read", content: await readFile(target, "utf8") };
}

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { renderCapabilities, renderToolDetail, loadManifests } from "./capabilities.js";

/** Resolves a vault-relative path, throwing if it escapes the root. */
function safe(root: string, p: string): string {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes vault: ${p}`);
  return abs;
}

/** Recursively lists files under a dir (vault-relative, forward slashes), skipping .git. */
function walk(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(root, p));
    else out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

/** The set of deterministic tool handlers bound to one vault root + list mode. */
export function makeHandlers(root: string, listMode: "flat" | "tiered") {
  /** Returns the capability map (L1) or, if `tool` given, that tool's detail (L2). */
  const list_capabilities = async (args: { tool?: string } = {}): Promise<string> =>
    args.tool ? renderToolDetail(root, args.tool) : renderCapabilities(root, listMode);

  /** Greps vault file contents; returns each matching file's path + body (fixtures are tiny). */
  const search = async (args: { query: string }): Promise<string> => {
    const q = String(args.query ?? "").toLowerCase();
    if (!q) return "no matches";
    const hits: string[] = [];
    for (const rel of walk(root)) {
      if (rel.endsWith(".json")) continue;
      const text = readFileSync(join(root, rel), "utf8");
      if (text.toLowerCase().includes(q)) hits.push(`${rel}:\n${text.trim().slice(0, 600)}`);
    }
    return hits.length ? hits.join("\n\n") : "no matches";
  };

  /** Returns the raw contents of a vault file. */
  const read = async (args: { path: string }): Promise<string> => {
    const abs = safe(root, String(args.path ?? ""));
    if (!existsSync(abs) || statSync(abs).isDirectory()) throw new Error(`not a file: ${args.path}`);
    return readFileSync(abs, "utf8");
  };

  /** Canned heavyweight-synthesis: returns the bodies of files matching any significant instruction term. */
  const query = async (args: { instruction: string }): Promise<string> => {
    const terms = String(args.instruction ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const blocks: string[] = [];
    const seen = new Set<string>();
    for (const rel of walk(root)) {
      if (rel.endsWith(".json")) continue;
      const text = readFileSync(join(root, rel), "utf8");
      if (terms.some((t) => text.toLowerCase().includes(t)) && !seen.has(rel)) {
        seen.add(rel);
        blocks.push(`${rel}:\n${text.trim().slice(0, 600)}`);
      }
    }
    return blocks.length ? `Synthesized from your vault:\n${blocks.join("\n\n")}` : "Nothing relevant in the vault.";
  };

  /** Writes a deterministic note so store→retrieve scenarios have ground truth. */
  const remember = async (args: { content: string; title?: string }): Promise<string> => {
    const content = String(args.content ?? "");
    const slug = createHash("sha1").update(content).digest("hex").slice(0, 8);
    const dir = join(root, "notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug}.md`), `---\ntitle: ${args.title ?? "note"}\n---\n${content}\n`);
    return `Filed note notes/${slug}.md`;
  };

  /** Validates the tool/action/connection exist and echoes the call (executor is stubbed). */
  const invoke = async (args: { tool?: string; action: string; connection?: string; params?: unknown }): Promise<string> => {
    const id = String(args.tool ?? "");
    const m = loadManifests(root).find((t) => t.id === id);
    if (!m) throw new Error(`unknown tool: ${id}`);
    if (!m.actions[String(args.action)]) throw new Error(`unknown action: ${id}.${args.action}`);
    if (args.connection !== undefined && m.connections && !m.connections.some((c) => c.label === args.connection)) {
      throw new Error(`connection '${args.connection}' is not set up for ${id}; available: ${m.connections.map((c) => c.label).join(", ")}`);
    }
    return JSON.stringify({ status: 200, tool: id, action: args.action, connection: args.connection ?? "default", ok: true });
  };

  return { list_capabilities, search, read, query, remember, invoke };
}

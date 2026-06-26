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
  return {
    /** Returns the capability map (L1) or, if `tool` given, that tool's detail (L2). */
    async list_capabilities(args: { tool?: string } = {}): Promise<string> {
      return args.tool ? renderToolDetail(root, args.tool) : renderCapabilities(root, listMode);
    },
    /** Greps vault file contents and returns matching paths + a snippet. */
    async search(args: { query: string }): Promise<string> {
      const q = String(args.query ?? "").toLowerCase();
      const hits: string[] = [];
      for (const rel of walk(root)) {
        if (rel.endsWith(".json")) continue;
        const text = readFileSync(join(root, rel), "utf8");
        const i = text.toLowerCase().indexOf(q);
        if (q && i >= 0) hits.push(`${rel}: …${text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ").trim()}…`);
      }
      return hits.length ? hits.join("\n") : "no matches";
    },
    /** Returns the raw contents of a vault file. */
    async read(args: { path: string }): Promise<string> {
      const abs = safe(root, String(args.path ?? ""));
      if (!existsSync(abs) || statSync(abs).isDirectory()) throw new Error(`not a file: ${args.path}`);
      return readFileSync(abs, "utf8");
    },
    /** Canned heavyweight-synthesis response (the internal agent is stubbed for the eval). */
    async query(args: { instruction: string }): Promise<string> {
      const found = await this.search({ query: String(args.instruction ?? "").split(/\s+/).slice(0, 3).join(" ") });
      return `Synthesized from your vault:\n${found}`;
    },
    /** Writes a deterministic note so store→retrieve scenarios have ground truth. */
    async remember(args: { content: string; title?: string }): Promise<string> {
      const content = String(args.content ?? "");
      const slug = createHash("sha1").update(content).digest("hex").slice(0, 8);
      const dir = join(root, "notes");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${slug}.md`), `---\ntitle: ${args.title ?? "note"}\n---\n${content}\n`);
      return `Filed note notes/${slug}.md`;
    },
    /** Validates the tool/action exist and echoes the call (executor is stubbed). */
    async invoke(args: { tool?: string; integration?: string; action: string; connection?: string; params?: unknown }): Promise<string> {
      const id = String(args.tool ?? args.integration ?? "");
      const m = loadManifests(root).find((t) => t.id === id);
      if (!m) throw new Error(`unknown tool: ${id}`);
      if (!m.actions[String(args.action)]) throw new Error(`unknown action: ${id}.${args.action}`);
      return JSON.stringify({ status: 200, tool: id, action: args.action, connection: args.connection ?? "default", ok: true });
    },
  };
}

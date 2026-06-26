import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Parsed YAML frontmatter fields extracted from a Markdown document. */
export interface Frontmatter { type?: string; title?: string; description?: string; tags?: string[] }
/** Aggregated summary of a vault's recipes, skills, and integrations. */
export interface CapabilitySummary {
  integrations: { name: string; description: string; actions: string[] }[];
  recipes: { title: string; description: string; path: string }[];
  text: string;
}

const RECIPE_TYPES = new Set(["recipe", "skill", "sop"]);

/** Parses YAML frontmatter from a Markdown string, returning the recognized fields. */
export function parseFrontmatter(md: string): Frontmatter {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const fm: Frontmatter = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, k, raw] = kv;
    const v = raw.trim();
    if (k === "type") fm.type = v;
    else if (k === "title") fm.title = v;
    else if (k === "description") fm.description = v;
    else if (k === "tags") fm.tags = v.replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return fm;
}

/** Recursively collects all Markdown file paths under a directory, skipping .git, node_modules, integrations, and artifacts. */
async function walkMd(dir: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "integrations" || e.name === "artifacts") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkMd(full, out);
    else if (e.name.endsWith(".md")) out.push(full);
  }
}

/** Scans a vault root directory to derive a summary of its integrations and Markdown-based recipes and skills. */
export async function deriveCapabilities(root: string): Promise<CapabilitySummary> {
  const integrations: CapabilitySummary["integrations"] = [];
  let intDirs: string[] = [];
  try { intDirs = (await readdir(join(root, "integrations"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* none */ }
  for (const name of intDirs) {
    try {
      const m = JSON.parse(await readFile(join(root, "integrations", name, "manifest.json"), "utf8"));
      integrations.push({ name: m.name ?? name, description: m.description ?? "", actions: Object.keys(m.actions ?? {}) });
    } catch { /* skip malformed */ }
  }
  const recipes: CapabilitySummary["recipes"] = [];
  const files: string[] = [];
  await walkMd(root, files);
  for (const f of files) {
    const fm = parseFrontmatter(await readFile(f, "utf8").catch(() => ""));
    if (fm.type && RECIPE_TYPES.has(fm.type)) {
      recipes.push({ title: fm.title ?? f, description: fm.description ?? "", path: f.slice(root.length + 1) });
    }
  }
  const lines: string[] = ["# Capabilities", "\n## Recipes & skills"];
  lines.push(recipes.length ? recipes.map((r) => `- ${r.title} — ${r.description} (${r.path})`).join("\n") : "(nothing yet)");
  lines.push("\n## Integrations");
  lines.push(integrations.length ? integrations.map((i) => `- ${i.name} — ${i.description} · actions: ${i.actions.join(", ")}`).join("\n") : "(nothing yet)");
  return { integrations, recipes, text: lines.join("\n") };
}

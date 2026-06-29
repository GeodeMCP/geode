import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolManifest } from "./types.js";

/** Reads every `tools/<id>/manifest.json` under the vault root. */
export function loadManifests(root: string): ToolManifest[] {
  const dir = join(root, "tools");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(dir, e.name, "manifest.json"))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, "utf8")) as ToolManifest)
    .sort((a, b) => a.id.localeCompare(b.id));
}

const conns = (m: ToolManifest): string =>
  (m.connections ?? []).map((c) => `${c.label} (${c.status}${c.description ? " — " + c.description : ""})`).join(", ");

/** The L1 map (`tiered`) or full dump (`flat`) plus the context index. */
export function renderCapabilities(root: string, mode: "flat" | "tiered"): string {
  const indexPath = join(root, "index.md");
  const context = existsSync(indexPath) ? readFileSync(indexPath, "utf8").trim() : "";
  const tools = loadManifests(root).map((m) => {
    const head = `- ${m.id} [${m.type}] — ${m.description} · connections: ${conns(m) || "—"}`;
    if (mode === "tiered") return head;
    const actions = Object.entries(m.actions).map(([a, def]) => `    - ${a}: ${def.description}`).join("\n");
    return `${head}\n${actions}`;
  });
  const drill = mode === "tiered" ? "\nUse list_capabilities(tool: <id>) for a tool's actions + params." : "";
  return `# Context\n${context}\n\n# Tools\n${tools.join("\n")}${drill}`;
}

/** L2 drill-down: actions + params for one tool. */
export function renderToolDetail(root: string, id: string): string {
  const m = loadManifests(root).find((t) => t.id === id);
  if (!m) return `Unknown tool: ${id}`;
  const actions = Object.entries(m.actions).map(([a, def]) => {
    const params = def.params.map((p) => `${p.name}${p.required ? "" : "?"}`).join(", ");
    return `- ${a}(${params}) — ${def.description}`;
  }).join("\n");
  return `# ${m.id} [${m.type}]\nconnections: ${conns(m) || "—"}\n${actions}`;
}

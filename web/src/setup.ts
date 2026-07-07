import type { ToolView } from "./api";

/** One tool connection that still needs its secrets set, with the exact store refs to capture. */
export interface SetupItem { tool: string; connection: string; refs: string[] }

/** Derives the connections that still need setup from the tool list, with each connection's `tool__connection__KEY` refs. */
export function pendingSetup(tools: ToolView[]): SetupItem[] {
  const out: SetupItem[] = [];
  for (const t of tools) {
    for (const c of t.connections) {
      if (!c.configured) out.push({ tool: t.id, connection: c.label, refs: (t.requires ?? []).map((k) => `${t.id}__${c.label}__${k}`) });
    }
  }
  return out;
}

import type { QueryResult } from "./query.js";

/** Builds a short, deterministic "what was written" line for a completed run — files touched plus the short commit — or "" when the run committed nothing (a read-only answer needs no envelope). */
export function formatOutcome(result: QueryResult): string {
  if (!result.commit) return "";
  const files = result.filesTouched ?? [];
  const shown = files.slice(0, 3).join(", ");
  const more = files.length > 3 ? ` +${files.length - 3} more` : "";
  const where = files.length ? ` to ${shown}${more}` : "";
  return `✓ saved${where} · commit ${result.commit.slice(0, 7)}`;
}

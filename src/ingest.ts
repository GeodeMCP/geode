import { query, type QueryDeps, type QueryResult } from "./query.js";
import type { ProgressEvent } from "./engine.js";

/** Arguments accepted by the remember function for ingesting content into the vault. */
export interface RememberArgs {
  content: string;
  source?: string;
  title?: string;
  workspace?: string;
}

/** Builds the natural-language instruction string that tells the engine how to integrate content into the vault. */
export function buildIngestInstruction(content: string, source?: string, title?: string): string {
  const lines = [
    "Integrate the following into the vault: find or create the right page for it, dedup against existing content, add cross-references, and keep it tidy. Then summarize what you filed and where.",
  ];
  if (title) lines.push(`Title hint: ${title}`);
  if (source) lines.push(`Source: ${source}`);
  lines.push(`Content:\n${content}`);
  return lines.join("\n");
}

/** Validates that content is non-empty, then runs a vault-ingest query via the engine. */
export async function remember(
  deps: QueryDeps,
  args: RememberArgs,
  onProgress?: (event: ProgressEvent) => void,
  opts?: { commit?: boolean },
): Promise<QueryResult> {
  if (!args.content || !args.content.trim()) {
    throw new Error("remember: content is required and cannot be empty");
  }
  return query(deps, buildIngestInstruction(args.content, args.source, args.title), onProgress, { ...opts, role: "librarian" });
}

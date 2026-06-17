import { delegate, type DelegateDeps, type DelegateResult } from "./delegate.js";

export interface RememberArgs {
  content: string;
  source?: string;
  title?: string;
  workspace?: string;
}

export function buildIngestInstruction(content: string, source?: string, title?: string): string {
  const lines = [
    "Integrate the following into the vault: find or create the right page for it, dedup against existing content, add cross-references, update index.md and capabilities.md if relevant, and keep it tidy. Then summarize what you filed and where.",
  ];
  if (title) lines.push(`Title hint: ${title}`);
  if (source) lines.push(`Source: ${source}`);
  lines.push(`Content:\n${content}`);
  return lines.join("\n");
}

export async function remember(
  deps: DelegateDeps,
  args: RememberArgs,
  onProgress?: (message: string) => void,
): Promise<DelegateResult> {
  if (!args.content || !args.content.trim()) {
    throw new Error("remember: content is required and cannot be empty");
  }
  return delegate(deps, buildIngestInstruction(args.content, args.source, args.title), onProgress);
}

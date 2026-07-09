/** A vault file's content kind, derived from its extension. */
export type Kind = "markdown" | "json" | "yaml" | "text";

/** Classifies a file path into a content kind and whether it has a rendered "formatted" form (Markdown only). */
export function fileType(path: string): { kind: Kind; hasFormatted: boolean } {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return { kind: "markdown", hasFormatted: true };
  if (ext === "json") return { kind: "json", hasFormatted: false };
  if (ext === "yaml" || ext === "yml") return { kind: "yaml", hasFormatted: false };
  return { kind: "text", hasFormatted: false };
}

/** Pretty-prints valid JSON with a 2-space indent; returns the input unchanged if it does not parse. */
export function prettyJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); }
  catch { return text; }
}

/** Builds the path + initial draft for a new file: trims/normalises the path, defaults the extension to .md, and scaffolds content by type. Returns null for blank input. */
export function newFileDraft(input: string): { path: string; draft: string } | null {
  let p = input.trim().replace(/^\/+/, "");
  if (!p) return null;
  if (!/\.[a-z0-9]+$/i.test(p)) p += ".md";
  const { kind } = fileType(p);
  if (kind === "markdown") {
    const title = p.replace(/\.[^.]+$/, "").split("/").pop() || "note";
    return { path: p, draft: `---\ntype: note\ntitle: ${title}\n---\n\n` };
  }
  if (kind === "json") return { path: p, draft: "{}" };
  return { path: p, draft: "" };
}

/** Returns the tool id when a path is a tool manifest (`tools/<id>/TOOL.md`), else null. */
export function toolManifestId(path: string): string | null {
  const m = /^tools\/([^/]+)\/TOOL\.md$/.exec(path);
  return m ? m[1] : null;
}
/** True when a tree path is anywhere under the `tools/` area (used for the tool icon). */
export function isToolPath(path: string): boolean {
  return path === "tools" || path.startsWith("tools/");
}

/** Structural top-level folders the vault convention defines — given their own icons and protected from deletion (their contents stay editable/deletable). */
export const SPECIAL_FOLDERS: ReadonlySet<string> = new Set(["tools", "backlog", "notes"]);

/** True when a path is one of the protected structural top-level folders (not deletable). */
export function isSpecialFolder(path: string): boolean {
  return SPECIAL_FOLDERS.has(path);
}

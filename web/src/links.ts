/** A classified Markdown link: an in-vault file (resolved path), an external URL, or ignorable. */
export type Link =
  | { kind: "internal"; path: string }
  | { kind: "external" }
  | { kind: "ignore" };

/** Classifies a Markdown link `href` relative to the file it appears in. Relative paths resolve against the source file's folder, normalising `.`/`..` (clamped at the vault root); a leading `/` is vault-root-absolute; `?`/`#` suffixes are stripped. Empty or in-page-anchor hrefs are ignorable; scheme/protocol-relative hrefs are external. */
export function resolveLink(fromFile: string, href: string): Link {
  const h = href.trim();
  if (!h || h.startsWith("#")) return { kind: "ignore" };
  if (h.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(h)) return { kind: "external" };
  const clean = h.replace(/[?#].*$/, "");
  if (!clean) return { kind: "ignore" };
  const baseDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const segs = clean.startsWith("/") ? [] : baseDir ? baseDir.split("/") : [];
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (segs.length) segs.pop(); continue; }
    segs.push(seg);
  }
  const path = segs.join("/");
  return path ? { kind: "internal", path } : { kind: "ignore" };
}

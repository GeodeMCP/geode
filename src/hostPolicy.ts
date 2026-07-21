import type { ToolManifest } from "./tools.js";

/** The lowercased hostname of a fully-resolved URL, or null if it cannot be parsed. */
export function targetHost(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/** The host portion of a manifest URL that may still contain `${...}`; returns it verbatim when it cannot be parsed as a real URL so a dynamic host stays visible. */
function manifestUrlHost(url: string): string {
  const real = targetHost(url);
  if (real) return real;
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return (m ? m[1] : url).toLowerCase();
}

/** Every external host a tool may contact: http action URLs + `permissions.network` array entries + `transport.url`. Lowercased, de-duplicated, sorted. */
export function declaredHosts(m: ToolManifest): string[] {
  const hosts = new Set<string>();
  for (const a of Object.values(m.actions)) if (a.http?.url) hosts.add(manifestUrlHost(a.http.url));
  if (Array.isArray(m.permissions?.network)) for (const h of m.permissions.network) hosts.add(h.toLowerCase());
  if (m.transport?.url) hosts.add(manifestUrlHost(m.transport.url));
  return [...hosts].sort();
}

/** Partitions a manifest's declared hosts into those present in `approved` and those not. */
export function hostStatus(m: ToolManifest, approved: string[]): { approved: string[]; pending: string[] } {
  const set = new Set(approved.map((h) => h.toLowerCase()));
  const declared = declaredHosts(m);
  return { approved: declared.filter((h) => set.has(h)), pending: declared.filter((h) => !set.has(h)) };
}

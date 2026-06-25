import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

/** Store interface for saving binary artifacts and issuing signed time-limited public URLs to them. */
export interface ArtifactStore {
  dir: string;
  save(relPath: string, data: Buffer): Promise<{ path: string; url: string }>;
  resolve(relPath: string): string;
  mintPublicUrl(relPath: string, ttlMs?: number): string;
  verifyPublic(relPath: string, exp: string, sig: string): boolean;
}

/** Creates a directory-backed artifact store that saves files, enforces path confinement, and signs public URLs with HMAC-SHA256. */
export function createArtifactStore(opts: { dir: string; baseUrl: string; signKey: Buffer; now?: () => number }): ArtifactStore {
  mkdirSync(opts.dir, { recursive: true });
  const now = opts.now ?? (() => Date.now());
  const resolveSafe = (rel: string): string => {
    const abs = resolve(opts.dir, rel);
    if (abs !== opts.dir && !abs.startsWith(opts.dir + sep)) throw new Error(`artifact path outside store: ${rel}`);
    return abs;
  };
  const sigFor = (rel: string, exp: string) => createHmac("sha256", opts.signKey).update(`${rel}:${exp}`).digest("hex");
  return {
    dir: opts.dir,
    resolve: resolveSafe,
    async save(rel, data) {
      const abs = resolveSafe(rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, data);
      return { path: rel, url: `${opts.baseUrl}/artifacts/${rel}` };
    },
    mintPublicUrl(rel, ttlMs = 3600_000) {
      const exp = String(now() + ttlMs);
      return `${opts.baseUrl}/artifacts/${rel}?exp=${exp}&sig=${sigFor(rel, exp)}`;
    },
    verifyPublic(rel, exp, sig) {
      if (Number(exp) < now()) return false;
      const expected = sigFor(rel, exp);
      const a = Buffer.from(sig), b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

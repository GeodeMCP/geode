export interface RateLimiter { check(key: string): { ok: boolean; retryAfter: number } }

// Fixed-window in-memory limiter: at most `limit` calls per `windowMs` per key.
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const hits = new Map<string, { count: number; start: number }>();
  return {
    check(key) {
      const t = now();
      const e = hits.get(key);
      if (!e || t - e.start >= opts.windowMs) { hits.set(key, { count: 1, start: t }); return { ok: true, retryAfter: 0 }; }
      e.count++;
      if (e.count > opts.limit) return { ok: false, retryAfter: Math.ceil((e.start + opts.windowMs - t) / 1000) };
      return { ok: true, retryAfter: 0 };
    },
  };
}

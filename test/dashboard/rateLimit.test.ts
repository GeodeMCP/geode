import { expect, test } from "vitest";
import { createRateLimiter } from "../../src/dashboard/rateLimit.js";

test("allows up to the limit, then trips, then recovers after the window", () => {
  let t = 1000;
  const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  expect([rl.check("ip").ok, rl.check("ip").ok, rl.check("ip").ok]).toEqual([true, true, true]);
  const tripped = rl.check("ip");
  expect(tripped.ok).toBe(false);
  expect(tripped.retryAfter).toBeGreaterThan(0);
  expect(rl.check("other").ok).toBe(true);   // independent key
  t += 1000;                                  // window elapsed
  expect(rl.check("ip").ok).toBe(true);
});

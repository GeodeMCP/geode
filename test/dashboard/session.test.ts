import { expect, test } from "vitest";
import { signSession, verifySession, parseCookie, sessionFromCookie } from "../../src/dashboard/session.js";

const key = Buffer.from("k".repeat(32));

test("signSession carries the subject and verifies; tampered/expired fail", () => {
  const now = 1_000_000;
  const tok = signSession(key, 60_000, "owner-1", () => now);
  expect(verifySession(key, tok, () => now)).toEqual({ sub: "owner-1" });
  expect(verifySession(key, tok + "x", () => now)).toBeNull();
  expect(verifySession(key, tok, () => now + 61_000)).toBeNull();
});

test("sessionFromCookie reads + verifies a cookie header", () => {
  const tok = signSession(key, 60_000, "owner-1");
  expect(sessionFromCookie(key, `a=1; geode_session=${tok}; b=2`)?.sub).toBe("owner-1");
  expect(sessionFromCookie(key, undefined)).toBeNull();
});

test("parseCookie reads a named cookie from a Cookie header", () => {
  expect(parseCookie("a=1; geode_session=abc.def; b=2", "geode_session")).toBe("abc.def");
  expect(parseCookie(undefined, "geode_session")).toBeNull();
});

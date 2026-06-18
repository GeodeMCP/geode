import { expect, test } from "vitest";
import { signSession, verifySession, parseCookie } from "../../src/dashboard/session.js";

const key = Buffer.from("k".repeat(32));

test("signSession round-trips and verifies; tampered/expired fail", () => {
  const now = 1_000_000;
  const tok = signSession(key, 60_000, () => now);
  expect(verifySession(key, tok, () => now)).toBe(true);
  expect(verifySession(key, tok + "x", () => now)).toBe(false);
  expect(verifySession(key, tok, () => now + 61_000)).toBe(false); // expired
});

test("parseCookie reads a named cookie from a Cookie header", () => {
  expect(parseCookie("a=1; geode_session=abc.def; b=2", "geode_session")).toBe("abc.def");
  expect(parseCookie(undefined, "geode_session")).toBeNull();
});

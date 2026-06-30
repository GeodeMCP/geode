import { test, expect } from "vitest";
import { hostAllowed } from "../src/egressProxy.js";

test("hostAllowed: exact match", () => {
  expect(hostAllowed("api.cloak.com", ["api.cloak.com"])).toBe(true);
});

test("hostAllowed: wildcard subdomain match", () => {
  expect(hostAllowed("api.cloak.com", ["*.cloak.com"])).toBe(true);
  expect(hostAllowed("deep.sub.cloak.com", ["*.cloak.com"])).toBe(false);
});

test("hostAllowed: wildcard does NOT match apex by default", () => {
  expect(hostAllowed("cloak.com", ["*.cloak.com"])).toBe(false);
});

test("hostAllowed: non-match is denied", () => {
  expect(hostAllowed("evil.com", ["api.cloak.com", "*.cloak.com"])).toBe(false);
});

test("hostAllowed: empty patterns deny all", () => {
  expect(hostAllowed("api.cloak.com", [])).toBe(false);
});

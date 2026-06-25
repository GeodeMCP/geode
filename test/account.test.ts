import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountStore } from "../src/account.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "geode-acct-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("no owner initially; createOwner then verify round-trips; persists across instances", () => {
  const s = createAccountStore(dir);
  expect(s.hasOwner()).toBe(false);
  const p = s.createOwner({ email: "me@example.com", password: "correct-horse" });
  expect(p.email).toBe("me@example.com");
  expect(p.id).toMatch(/[0-9a-f-]{36}/);
  expect(s.hasOwner()).toBe(true);
  expect(s.verify("me@example.com", "correct-horse")?.id).toBe(p.id);
  expect(s.verify("me@example.com", "wrong")).toBeNull();
  expect(s.verify("other@example.com", "correct-horse")).toBeNull();
  // a fresh instance reads the persisted record
  expect(createAccountStore(dir).getOwner()?.email).toBe("me@example.com");
});

test("rejects a second owner, weak passwords, and bad emails", () => {
  const s = createAccountStore(dir);
  s.createOwner({ email: "me@example.com", password: "correct-horse" });
  expect(() => s.createOwner({ email: "x@y.com", password: "abcdefghij" })).toThrow(/already exists/);
  const s2 = createAccountStore(mkdtempSync(join(tmpdir(), "geode-acct2-")));
  expect(() => s2.createOwner({ email: "me@example.com", password: "short" })).toThrow(/at least/);
  expect(() => s2.createOwner({ email: "not-an-email", password: "abcdefghij" })).toThrow(/email/);
});

test("email is normalized: created with mixed case, verifies lowercased", () => {
  const s = createAccountStore(dir);
  const p = s.createOwner({ email: "Me@Example.com", password: "correct-horse" });
  expect(s.verify("me@example.com", "correct-horse")?.id).toBe(p.id);
});

test("setPassword changes the stored hash", () => {
  const s = createAccountStore(dir);
  s.createOwner({ email: "me@example.com", password: "correct-horse" });
  s.setPassword("me@example.com", "new-passphrase");
  expect(s.verify("me@example.com", "correct-horse")).toBeNull();
  expect(s.verify("me@example.com", "new-passphrase")).not.toBeNull();
});

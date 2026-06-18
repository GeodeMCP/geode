import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStore, loadOrCreateKey } from "../src/secrets.js";

let dir: string; const key = randomBytes(32);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "geode-sec-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("set/get/list/delete round-trip; persists encrypted", async () => {
  const s = createSecretStore({ dir, key });
  await s.set("NOTION_TOKEN", "secret-abc");
  expect(await s.get("NOTION_TOKEN")).toBe("secret-abc");
  expect(await s.list()).toEqual(["NOTION_TOKEN"]);
  const s2 = createSecretStore({ dir, key });
  expect(await s2.get("NOTION_TOKEN")).toBe("secret-abc");
  await s2.delete("NOTION_TOKEN");
  expect(await s2.get("NOTION_TOKEN")).toBeNull();
});

test("wrong key fails to decrypt (does not return the value)", async () => {
  const s = createSecretStore({ dir, key }); await s.set("K", "v");
  const bad = createSecretStore({ dir, key: randomBytes(32) });
  await expect(bad.get("K")).rejects.toThrow();
});

test("loadOrCreateKey generates a 32-byte key file and reuses it", () => {
  const k1 = loadOrCreateKey(dir); const k2 = loadOrCreateKey(dir);
  expect(k1.length).toBe(32); expect(k1.equals(k2)).toBe(true);
});

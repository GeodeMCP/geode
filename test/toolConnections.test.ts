import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { createSecretStore, loadOrCreateKey } from "../src/secrets.js";
import { loadConnBundle, connectionConfigured } from "../src/tools.js";

function store() { const dir = mkdtempSync(join(tmpdir(), "geode-sec-")); return createSecretStore({ dir, key: loadOrCreateKey(dir) }); }

test("connectionConfigured true only when all requires keys are present", async () => {
  const s = store();
  expect(await connectionConfigured(s, "gmail", "acme-sales", ["TOKEN"])).toBe(false);
  await s.set("gmail__acme-sales__TOKEN", "abc");
  expect(await connectionConfigured(s, "gmail", "acme-sales", ["TOKEN"])).toBe(true);
});

test("loadConnBundle returns the values, throws on a missing required key", async () => {
  const s = store();
  await s.set("gmail__acme-sales__TOKEN", "abc");
  expect(await loadConnBundle(s, "gmail", "acme-sales", ["TOKEN"])).toEqual({ TOKEN: "abc" });
  await expect(loadConnBundle(s, "gmail", "acme-sales", ["NADA"])).rejects.toThrow(/needs setup/);
});

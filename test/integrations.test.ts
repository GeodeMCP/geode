import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIntegration, resolveTemplate } from "../src/integrations.js";

test("resolveTemplate substitutes params and secrets", () => {
  expect(resolveTemplate("Bearer ${secrets.K}", { params: {}, secrets: { K: "abc" } })).toBe("Bearer abc");
  expect(resolveTemplate("/u/${params.id}", { params: { id: "7" }, secrets: {} })).toBe("/u/7");
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-int-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("loadIntegration parses a manifest; throws on missing", async () => {
  mkdirSync(join(root, "integrations", "x"), { recursive: true });
  writeFileSync(join(root, "integrations", "x", "manifest.json"), JSON.stringify({ name: "x", type: "connection", description: "d", requires: ["K"], actions: { ping: { method: "GET", url: "https://h/p" } } }));
  const m = await loadIntegration(root, "x");
  expect(m.actions.ping.method).toBe("GET");
  await expect(loadIntegration(root, "nope")).rejects.toThrow();
});

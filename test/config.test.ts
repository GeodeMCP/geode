import { expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { GEODE_AUTH_TOKEN: "secret", GEODE_WORKSPACE: "/tmp/vault" };

test("loads required fields and applies defaults", () => {
  const cfg = loadConfig(base);
  expect(cfg.authToken).toBe("secret");
  expect(cfg.workspaceRoot).toBe("/tmp/vault");
  expect(cfg.port).toBe(8787);
  expect(cfg.maxRuntimeMs).toBe(300000);
  expect(cfg.queueLimit).toBe(4);
  expect(cfg.model).toBeUndefined();
});

test("reads overrides", () => {
  const cfg = loadConfig({ ...base, GEODE_PORT: "9000", GEODE_MODEL: "claude-opus-4-8", GEODE_MAX_RUNTIME_MS: "60000" });
  expect(cfg.port).toBe(9000);
  expect(cfg.model).toBe("claude-opus-4-8");
  expect(cfg.maxRuntimeMs).toBe(60000);
});

test("throws when a required field is missing", () => {
  expect(() => loadConfig({ GEODE_WORKSPACE: "/tmp/vault" })).toThrow(/GEODE_AUTH_TOKEN/);
});

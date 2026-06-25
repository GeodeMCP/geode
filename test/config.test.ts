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

test("derives artifactsDir, baseUrl and secretsDir from defaults", () => {
  const cfg = loadConfig(base);
  expect(cfg.artifactsDir).toBe("/tmp/vault/artifacts");
  expect(cfg.baseUrl).toBe("http://localhost:8787");
  expect(cfg.secretsDir).toMatch(/\/.geode\/secrets$/);
});

test("env overrides for artifactsDir, baseUrl and secretsDir", () => {
  const cfg = loadConfig({
    ...base,
    GEODE_ARTIFACTS_DIR: "/data/artifacts",
    GEODE_BASE_URL: "https://example.com",
    GEODE_SECRETS_DIR: "/run/secrets",
  });
  expect(cfg.artifactsDir).toBe("/data/artifacts");
  expect(cfg.baseUrl).toBe("https://example.com");
  expect(cfg.secretsDir).toBe("/run/secrets");
});

test("dashboardPassword is read from env and is undefined by default", () => {
  const base = { GEODE_AUTH_TOKEN: "t", GEODE_WORKSPACE: "/tmp/x" };
  expect(loadConfig({ ...base }).dashboardPassword).toBeUndefined();
  expect(loadConfig({ ...base, GEODE_DASHBOARD_PASSWORD: "hunter2" }).dashboardPassword).toBe("hunter2");
});

test("accountDir defaults to ~/.geode and can be overridden", () => {
  expect(loadConfig(base).accountDir).toMatch(/\/.geode$/);
  expect(loadConfig({ ...base, GEODE_ACCOUNT_DIR: "/run/geode" }).accountDir).toBe("/run/geode");
});

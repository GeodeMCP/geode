import { describe, it, expect } from "vitest";
import { buildRunnerEnv } from "../../src/runner/provision.js";

describe("buildRunnerEnv", () => {
  const source = {
    ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "https://gw", PATH: "/usr/bin",
    GEODE_SECRETS_KEY: "MASTER", GEODE_AUTH_TOKEN: "tok", GEODE_SIGN_KEY: "s",
    HOME: "/root", SECRET_SOMETHING: "nope",
  } as NodeJS.ProcessEnv;

  it("forwards only the allowlist and overrides HOME/TMPDIR", () => {
    const env = buildRunnerEnv(source, { home: "/runner-home", tmpdir: "/runner-tmp" });
    expect(env).toEqual({
      ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "https://gw",
      PATH: "/usr/bin", HOME: "/runner-home", TMPDIR: "/runner-tmp",
    });
  });

  it("contains NO GEODE_* key (the load-bearing property)", () => {
    const env = buildRunnerEnv(source, { home: "/h", tmpdir: "/t" });
    expect(Object.keys(env).some((k) => k.startsWith("GEODE_"))).toBe(false);
  });

  it("omits ANTHROPIC_BASE_URL when the source lacks it", () => {
    const env = buildRunnerEnv({ ANTHROPIC_API_KEY: "k", PATH: "/b" } as NodeJS.ProcessEnv, { home: "/h", tmpdir: "/t" });
    expect("ANTHROPIC_BASE_URL" in env).toBe(false);
  });
});

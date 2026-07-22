import { describe, it, expect } from "vitest";
import { buildRunnerEnv, resolveRunnerPrivilege, provisionRunner } from "../../src/runner/provision.js";

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

describe("resolveRunnerPrivilege", () => {
  it("drops to the configured uid/gid when root", () => {
    expect(resolveRunnerPrivilege({ runnerUid: 1001, runnerGid: 1002 }, () => 0))
      .toEqual({ uid: 1001, gid: 1002, mode: "dropped" });
  });
  it("falls back to same-uid when not root", () => {
    const r = resolveRunnerPrivilege({ runnerUid: 1001, runnerGid: 1002 }, () => 501);
    expect(r.mode).toBe("same-uid");
    expect(r.uid).toBeUndefined();
    expect(r.reason).toMatch(/root/);
  });
  it("falls back to same-uid when no runner uid configured (even as root)", () => {
    const r = resolveRunnerPrivilege({}, () => 0);
    expect(r.mode).toBe("same-uid");
    expect(r.reason).toMatch(/configured/);
  });
  it("treats undefined getuid (non-POSIX) as non-root", () => {
    expect(resolveRunnerPrivilege({ runnerUid: 1001 }, () => undefined).mode).toBe("same-uid");
  });
});

describe("provisionRunner", () => {
  const cfg = { runnerHome: "/rh", runnerUid: 1001, runnerGid: 1002 } as any;
  it("returns dropped uid + scrubbed env + ensures dirs + logs when root", () => {
    const dirs: string[] = []; const logs: string[] = [];
    const out = provisionRunner({ ...cfg }, {
      pkgRoot: "/pkg", getuid: () => 0, log: (m) => logs.push(m), ensureDir: (p) => dirs.push(p),
      source: { ANTHROPIC_API_KEY: "k", PATH: "/b", GEODE_SECRETS_KEY: "M" } as any,
    });
    expect(out.uid).toBe(1001);
    expect(out.cwd).toBe("/pkg");
    expect(out.env.HOME).toBe("/rh");
    expect(Object.keys(out.env).some((k) => k.startsWith("GEODE_"))).toBe(false);
    expect(dirs).toContain("/rh");
    expect(logs.join(" ")).toMatch(/dropped to uid 1001/);
  });
  it("same-uid + loud warning when not root", () => {
    const logs: string[] = [];
    const out = provisionRunner({ ...cfg }, {
      pkgRoot: "/pkg", getuid: () => 501, log: (m) => logs.push(m), ensureDir: () => {},
      source: { ANTHROPIC_API_KEY: "k", PATH: "/b" } as any,
    });
    expect(out.uid).toBeUndefined();
    expect(logs.join(" ")).toMatch(/SAME-UID/);
  });
});

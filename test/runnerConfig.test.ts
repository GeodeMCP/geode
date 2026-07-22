import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { homedir } from "node:os";
import { join } from "node:path";

const base = { GEODE_AUTH_TOKEN: "t", GEODE_WORKSPACE: "/v" };

describe("runner config", () => {
  it("parses runner uid/gid as numbers and defaults runnerHome", () => {
    const c = loadConfig({ ...base, GEODE_RUNNER_UID: "1001", GEODE_RUNNER_GID: "1002" });
    expect(c.runnerUid).toBe(1001);
    expect(c.runnerGid).toBe(1002);
    expect(c.runnerHome).toBe(join(homedir(), ".geode", "runner-home"));
  });
  it("leaves uid/gid undefined when unset (same-uid mode)", () => {
    const c = loadConfig(base);
    expect(c.runnerUid).toBeUndefined();
    expect(c.runnerGid).toBeUndefined();
  });
});

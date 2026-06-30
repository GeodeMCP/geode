import { test, expect } from "vitest";
import { buildDockerfile, runArgs, imageTag } from "../src/docker.js";
import type { ToolManifest } from "../src/tools.js";

const M: ToolManifest = {
  id: "cb", name: "CB", type: "cli", description: "d",
  image: { base: "node:20-slim" },
  source: { repo: "https://github.com/x/cb", ref: "v1" },
  install: ["npm ci", "npm run build"], bin: "./cb",
  actions: { fetch: { command: ["fetch", "--url", "x"] } },
};

test("imageTag is per id+ref", () => {
  expect(imageTag(M)).toBe("geode-tool/cb:v1");
});

test("buildDockerfile clones the pinned ref and runs install in the image", () => {
  const df = buildDockerfile(M);
  expect(df).toContain("FROM node:20-slim");
  expect(df).toContain("git clone");
  expect(df).toContain("v1");
  expect(df).toContain("RUN npm ci");
  expect(df).toContain("RUN npm run build");
  expect(df).not.toContain("${"); // no unresolved secrets ever in the image
});

test("runArgs builds a locked-down docker run argv", () => {
  const args = runArgs({ name: "geode-cb-abc123", tag: "geode-tool/cb:v1", command: ["./cb", "fetch", "--url", "x"], envFile: "/tmp/e", network: "none", memoryMb: 256, cpus: 1, timeoutMs: 30000 });
  expect(args).toContain("run");
  expect(args).toContain("--rm");
  expect(args).toContain("--name"); expect(args).toContain("geode-cb-abc123");
  expect(args).toContain("--network"); expect(args).toContain("none");
  expect(args).toContain("--read-only");
  expect(args).toContain("--cap-drop"); expect(args).toContain("ALL");
  expect(args).toContain("--security-opt"); expect(args).toContain("no-new-privileges");
  expect(args).toContain("--pids-limit"); expect(args).toContain("256");
  expect(args).toContain("--tmpfs"); expect(args).toContain("/tmp:rw,noexec,nosuid,size=64m");
  expect(args).toContain("--env-file"); expect(args).toContain("/tmp/e");
  expect(args).toContain("--memory"); expect(args).toContain("256m");
  expect(args).toContain("geode-tool/cb:v1");
  expect(args.slice(args.indexOf("geode-tool/cb:v1") + 1)).toEqual(["./cb", "fetch", "--url", "x"]);
});

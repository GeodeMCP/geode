/**
 * Docker-gated end-to-end integration test for the CLI executor.
 *
 * Exercises the REAL Docker path: installTool (builds image + smoke) →
 * runCliTool (fresh container per call, env-file creds, --network none).
 *
 * Excluded from the default `npm test` suite (see vitest.config.ts exclude).
 * Run with: npm run test:docker
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, cpSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realDocker } from "../../src/docker.js";
import { installTool, readInstallState } from "../../src/installer.js";
import { runCliTool } from "../../src/sandboxRun.js";

// ---------------------------------------------------------------------------
// Docker availability gate
// ---------------------------------------------------------------------------
const docker = realDocker();
const dockerPresent = await docker.available();

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------
const FIXTURE_DIR = new URL("./fixture-tool", import.meta.url).pathname;
const TOOL_ID = "echo-tool";
const IMAGE_TAG = "geode-tool/echo-tool:latest";

// ---------------------------------------------------------------------------
// Shared test deps (created once per suite)
// ---------------------------------------------------------------------------
let root: string;
let toolsDir: string;

/** Minimal in-memory secret store for the fixture tool's TOKEN credential. */
const secrets = {
  get: async (ref: string) => ref === "echo-tool__default__TOKEN" ? "test-secret" : null,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe.skipIf(!dockerPresent)("CLI executor — Docker end-to-end", { timeout: 180_000 }, () => {
  beforeAll(async () => {
    // Copy fixture vault to a temp dir so the test is isolated
    root = mkdtempSync(join(tmpdir(), "geode-e2e-root-"));
    mkdirSync(join(root, "tools"), { recursive: true });
    cpSync(join(FIXTURE_DIR, "tools", TOOL_ID), join(root, "tools", TOOL_ID), { recursive: true });
    toolsDir = mkdtempSync(join(tmpdir(), "geode-e2e-tools-"));

    // Build the image once for all tests in this suite
    await installTool({ root, toolsDir, docker }, TOOL_ID, { network: "none" });
  }, 180_000);

  afterAll(async () => {
    // Remove the built image so we don't pollute the host
    await docker.removeImage(IMAGE_TAG);
  });

  test("installTool builds image, smoke passes, and records install state", async () => {
    const state = await readInstallState(toolsDir, TOOL_ID);
    expect(state).not.toBeNull();
    expect(state!.image).toBe(IMAGE_TAG);
    expect(state!.id).toBe(TOOL_ID);
    expect(state!.approvedAt).toBeTruthy();
  });

  test("runCliTool returns echoed JSON with the injected credential", async () => {
    const result = await runCliTool(
      { root, toolsDir, docker, secrets },
      TOOL_ID, "token-check", {}, "default",
    );
    expect(result.status).toBe(0);
    expect(result.body).toEqual({ token: "test-secret" });
  });

  test("runCliTool returns the echoed url param as JSON", async () => {
    const result = await runCliTool(
      { root, toolsDir, docker, secrets },
      TOOL_ID, "fetch", { url: "https://example.com" }, "default",
    );
    expect(result.status).toBe(0);
    expect(result.body).toEqual({ url: "https://example.com" });
  });

  test("--network none is enforced: a network-bound action exits non-zero", async () => {
    const result = await runCliTool(
      { root, toolsDir, docker, secrets },
      TOOL_ID, "net-check", {}, "default",
    );
    // With --network none the node http.get fails → script exits 1
    expect(result.status).not.toBe(0);
  });

  test("temp env-file is cleaned up after runCliTool returns", async () => {
    const td = tmpdir();
    const before = (await readdir(td)).filter((n) => n.startsWith("geode-env-"));
    await runCliTool(
      { root, toolsDir, docker, secrets },
      TOOL_ID, "fetch", { url: "https://cleanup-test.example" }, "default",
    );
    const after = (await readdir(td)).filter((n) => n.startsWith("geode-env-"));
    // No new geode-env-* directories should remain after the call
    const newDirs = after.filter((n) => !before.includes(n));
    expect(newDirs).toHaveLength(0);
  });

  test("invoking an uninstalled tool throws 'must install' error", async () => {
    const emptyToolsDir = mkdtempSync(join(tmpdir(), "geode-e2e-empty-"));
    await expect(
      runCliTool(
        { root, toolsDir: emptyToolsDir, docker, secrets },
        TOOL_ID, "fetch", { url: "https://x" }, "default",
      ),
    ).rejects.toThrow(/must install/);
  });
});

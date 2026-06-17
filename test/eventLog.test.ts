import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog } from "../src/eventLog.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-log-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("appends grep-able lines to log.md", async () => {
  const log = createEventLog(root, () => "2026-06-17T10:00:00Z");
  await log.append({ runId: "run-1", instruction: "do X", status: "ok", commit: "abc123", summary: "did X" });
  await log.append({ runId: "run-2", instruction: "do Y", status: "error", error: "boom" });

  const text = readFileSync(join(root, "log.md"), "utf8");
  expect(text).toContain("## [2026-06-17T10:00:00Z] run-1 | ok | abc123");
  expect(text).toContain("do X");
  expect(text).toContain("## [2026-06-17T10:00:00Z] run-2 | error");
  expect(text).toContain("boom");
});

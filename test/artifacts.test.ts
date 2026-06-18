import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../src/artifacts.js";

let dir: string;
const store = () => createArtifactStore({ dir, baseUrl: "http://h:8787", signKey: Buffer.from("k".repeat(32)) });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "geode-art-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("save writes the file and returns a bearer URL", async () => {
  const s = store();
  const r = await s.save("report.md", Buffer.from("hello"));
  expect(existsSync(join(dir, "report.md"))).toBe(true);
  expect(r.url).toBe("http://h:8787/artifacts/report.md");
});

test("resolve rejects path traversal", () => {
  expect(() => store().resolve("../etc/passwd")).toThrow(/outside/);
});

test("signed public URL verifies; tampered/expired fail", () => {
  const s = store();
  const url = s.mintPublicUrl("report.md", 1000);
  const u = new URL(url);
  expect(s.verifyPublic("report.md", u.searchParams.get("exp")!, u.searchParams.get("sig")!)).toBe(true);
  expect(s.verifyPublic("report.md", u.searchParams.get("exp")!, "bad")).toBe(false);
  expect(s.verifyPublic("report.md", "1", u.searchParams.get("sig")!)).toBe(false);
});

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { stageFiles } from "../../src/dashboard/uploads.js";

describe("stageFiles", () => {
  it("writes plain files and expands zip entries, preserving relative paths", async () => {
    const base = mkdtempSync(join(tmpdir(), "geode-stage-"));
    const zip = new AdmZip();
    zip.addFile("skills/booking.md", Buffer.from("# booking"));
    const written = await stageFiles(base, [
      { relPath: "reference/notes.md", buffer: Buffer.from("hello") },
      { relPath: "bundle.zip", buffer: zip.toBuffer() },
    ]);
    expect(written.sort()).toEqual(["reference/notes.md", "skills/booking.md"]);
    expect(readFileSync(join(base, "reference/notes.md"), "utf8")).toBe("hello");
    expect(readFileSync(join(base, "skills/booking.md"), "utf8")).toBe("# booking");
    rmSync(base, { recursive: true, force: true });
  });
  it("rejects a path that escapes the staging dir", async () => {
    const base = mkdtempSync(join(tmpdir(), "geode-stage-"));
    await expect(stageFiles(base, [{ relPath: "../evil.md", buffer: Buffer.from("x") }])).rejects.toThrow(/unsafe/);
    expect(existsSync(join(base, "..", "evil.md"))).toBe(false);
    rmSync(base, { recursive: true, force: true });
  });
});

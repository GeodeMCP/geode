import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
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
  it("rejects a zip entry that escapes the staging dir", async () => {
    const outer = mkdtempSync(join(tmpdir(), "geode-stage-"));
    const stage = join(outer, "stage");
    // Create a malicious zip by adding a file and then manually modifying its entry name
    // to bypass adm-zip's path normalization
    const zip = new AdmZip();
    zip.addFile("normal.md", Buffer.from("x"));
    const entries = zip.getEntries();
    // Directly modify the entry name to contain a traversal
    entries[0].entryName = "../escaped.md";
    const maliciousZip = zip.toBuffer();
    await expect(stageFiles(stage, [{ relPath: "bundle.zip", buffer: maliciousZip }])).rejects.toThrow(/unsafe/);
    expect(existsSync(join(outer, "escaped.md"))).toBe(false);
    rmSync(outer, { recursive: true, force: true });
  });
  it("skips directory entries in a zip", async () => {
    const base = mkdtempSync(join(tmpdir(), "geode-stage-"));
    const zip = new AdmZip();
    zip.addFile("dir/", Buffer.alloc(0));
    zip.addFile("dir/file.md", Buffer.from("y"));
    const written = await stageFiles(base, [{ relPath: "bundle.zip", buffer: zip.toBuffer() }]);
    expect(written).toEqual(["dir/file.md"]);
    rmSync(base, { recursive: true, force: true });
  });
});

import { createAttachmentStore } from "../../src/dashboard/uploads.js";

describe("createAttachmentStore", () => {
  it("adds files across calls, lists them, and clears the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "geode-att-"));
    const store = createAttachmentStore({ dir });
    expect(store.dir).toBe(dir);
    const added = await store.add([{ relPath: "reference/a.md", buffer: Buffer.from("hi") }]);
    expect(added).toEqual(["reference/a.md"]);
    expect(readFileSync(join(dir, "reference/a.md"), "utf8")).toBe("hi");
    await store.add([{ relPath: "b.md", buffer: Buffer.from("yo") }]);
    expect((await store.list()).sort()).toEqual(["b.md", "reference/a.md"]);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it("lists nothing for an absent folder", async () => {
    const store = createAttachmentStore({ dir: join(tmpdir(), "geode-att-absent-does-not-exist") });
    expect(await store.list()).toEqual([]);
  });
});

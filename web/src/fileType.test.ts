import { describe, it, expect } from "vitest";
import { fileType, prettyJson, newFileDraft, toolManifestId, isToolPath } from "./fileType";

describe("fileType", () => {
  it("classifies by extension", () => {
    expect(fileType("a.md")).toEqual({ kind: "markdown", hasFormatted: true });
    expect(fileType("notes/a.markdown")).toEqual({ kind: "markdown", hasFormatted: true });
    expect(fileType("a.json")).toEqual({ kind: "json", hasFormatted: false });
    expect(fileType("a.yaml")).toEqual({ kind: "yaml", hasFormatted: false });
    expect(fileType("a.yml")).toEqual({ kind: "yaml", hasFormatted: false });
    expect(fileType("a.txt")).toEqual({ kind: "text", hasFormatted: false });
    expect(fileType("README")).toEqual({ kind: "text", hasFormatted: false });
  });
});

describe("prettyJson", () => {
  it("indents valid JSON with 2 spaces", () => {
    expect(prettyJson('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
  });
  it("returns input unchanged when invalid", () => {
    expect(prettyJson("not json")).toBe("not json");
  });
});

describe("newFileDraft", () => {
  it("normalises path and defaults to .md with a note scaffold", () => {
    const r = newFileDraft("  /notes/idea ");
    expect(r).toEqual({ path: "notes/idea.md", draft: "---\ntype: note\ntitle: idea\n---\n\n" });
  });
  it("scaffolds {} for json", () => {
    expect(newFileDraft("data.json")).toEqual({ path: "data.json", draft: "{}" });
  });
  it("scaffolds empty for other extensions", () => {
    expect(newFileDraft("a.txt")).toEqual({ path: "a.txt", draft: "" });
  });
  it("returns null for blank input", () => {
    expect(newFileDraft("   ")).toBeNull();
  });
});

describe("toolManifestId", () => {
  it("returns the id for a tool manifest", () => { expect(toolManifestId("tools/cloakbrowser/TOOL.md")).toBe("cloakbrowser"); });
  it("rejects non-manifest tool paths", () => {
    expect(toolManifestId("tools/cloakbrowser/other.md")).toBeNull();
    expect(toolManifestId("tools/TOOL.md")).toBeNull();
    expect(toolManifestId("notes/TOOL.md")).toBeNull();
  });
});
describe("isToolPath", () => {
  it("is true under tools/", () => { expect(isToolPath("tools")).toBe(true); expect(isToolPath("tools/x/TOOL.md")).toBe(true); });
  it("is false elsewhere", () => { expect(isToolPath("notes/a.md")).toBe(false); expect(isToolPath("toolsmith/a")).toBe(false); });
});

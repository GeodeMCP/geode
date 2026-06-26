import { describe, it, expect } from "vitest";
import { resolveLink } from "./links";

describe("resolveLink", () => {
  it("resolves relative in-vault paths against the source file's folder", () => {
    expect(resolveLink("notes/a.md", "../experiments/b.md")).toEqual({ kind: "internal", path: "experiments/b.md" });
    expect(resolveLink("index.md", "experiments/index.md")).toEqual({ kind: "internal", path: "experiments/index.md" });
    expect(resolveLink("notes/a.md", "./c.md")).toEqual({ kind: "internal", path: "notes/c.md" });
  });
  it("clamps .. at the vault root", () => {
    expect(resolveLink("a.md", "../../x.md")).toEqual({ kind: "internal", path: "x.md" });
  });
  it("treats a leading slash as vault-root-absolute", () => {
    expect(resolveLink("notes/a.md", "/experiments/b.md")).toEqual({ kind: "internal", path: "experiments/b.md" });
  });
  it("strips a query/hash suffix", () => {
    expect(resolveLink("notes/a.md", "../experiments/b.md#sec")).toEqual({ kind: "internal", path: "experiments/b.md" });
  });
  it("classifies external links", () => {
    expect(resolveLink("a.md", "https://example.com")).toEqual({ kind: "external" });
    expect(resolveLink("a.md", "mailto:x@y.com")).toEqual({ kind: "external" });
    expect(resolveLink("a.md", "//cdn.com/x")).toEqual({ kind: "external" });
  });
  it("ignores empty and in-page anchors", () => {
    expect(resolveLink("a.md", "#heading")).toEqual({ kind: "ignore" });
    expect(resolveLink("a.md", "")).toEqual({ kind: "ignore" });
  });
});

import { describe, it, expect } from "vitest";
import { isArtifactPath, artifactRelPath, buildArtifactTree } from "./artifacts";

describe("isArtifactPath", () => {
  it("matches the synthetic branch", () => { expect(isArtifactPath("artifacts")).toBe(true); expect(isArtifactPath("artifacts/x.png")).toBe(true); });
  it("rejects others", () => { expect(isArtifactPath("notes/a.md")).toBe(false); expect(isArtifactPath("artifactsx")).toBe(false); });
});
describe("artifactRelPath", () => {
  it("strips the prefix", () => { expect(artifactRelPath("artifacts/sub/b.png")).toBe("sub/b.png"); expect(artifactRelPath("artifacts/a.md")).toBe("a.md"); });
});
describe("buildArtifactTree", () => {
  it("nests paths under artifacts/", () => {
    const t = buildArtifactTree(["a.md", "sub/b.png", "sub/c.txt"]);
    expect(t.map((n) => n.name).sort()).toEqual(["a.md", "sub"]);
    const sub = t.find((n) => n.name === "sub")!;
    expect(sub.type).toBe("dir");
    expect(sub.path).toBe("artifacts/sub");
    expect(sub.children!.map((n) => n.path).sort()).toEqual(["artifacts/sub/b.png", "artifacts/sub/c.txt"]);
    const leaf = t.find((n) => n.name === "a.md")!;
    expect(leaf.type).toBe("file"); expect(leaf.path).toBe("artifacts/a.md");
  });
  it("returns [] for no artifacts", () => { expect(buildArtifactTree([])).toEqual([]); });
});

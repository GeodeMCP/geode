import type { TreeNode } from "./api";

/** True when a tree path is the synthetic artifacts branch (`artifacts` or `artifacts/...`). */
export function isArtifactPath(path: string): boolean {
  return path === "artifacts" || path.startsWith("artifacts/");
}
/** Strips the synthetic `artifacts/` prefix to get the path relative to artifactsDir (for the artifact endpoints). */
export function artifactRelPath(path: string): string {
  return path.replace(/^artifacts\//, "");
}
/** Builds a nested TreeNode subtree (children of a synthetic `artifacts/` root) from artifactsDir-relative paths. */
export function buildArtifactTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const rel of paths) {
    const segs = rel.split("/");
    let level = root, prefix = "artifacts";
    segs.forEach((seg, i) => {
      prefix += "/" + seg;
      const isLeaf = i === segs.length - 1;
      let node = level.find((n) => n.name === seg);
      if (!node) {
        node = isLeaf ? { name: seg, path: prefix, type: "file" } : { name: seg, path: prefix, type: "dir", children: [] };
        level.push(node);
      }
      if (!isLeaf) level = node.children!;
    });
  }
  return root;
}

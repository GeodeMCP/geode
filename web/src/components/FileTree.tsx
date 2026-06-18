import type { TreeNode } from "../api";
export function FileTree({ tree, status, selected, onSelect }: {
  tree: TreeNode[]; status: { modified: string[]; created: string[] }; selected: string | null; onSelect: (p: string) => void;
}) {
  const render = (nodes: TreeNode[], depth = 0) => nodes.map((n) => (
    <div key={n.path}>
      <div className={`row ${n.type === "file" && depth > 0 ? "sub" : ""} ${selected === n.path ? "active" : ""}`}
        style={{ paddingLeft: 20 + depth * 16 }} onClick={() => n.type === "file" && onSelect(n.path)}>
        <span>{n.name}</span>
        <span className="spacer" />
        {status.modified.includes(n.path) && <span className="dot-mod" />}
        {status.created.includes(n.path) && <span className="badge new">nieuw</span>}
      </div>
      {n.children && render(n.children, depth + 1)}
    </div>
  ));
  return <div className="col tree"><div className="eyebrow">Vault</div><div className="tree-list">{render(tree)}</div></div>;
}

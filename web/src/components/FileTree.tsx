import type { TreeNode } from "../api";

const FolderIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
  </svg>
);
const FileIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
  </svg>
);

export function FileTree({ tree, status, selected, onSelect, onNew }: {
  tree: TreeNode[]; status: { modified: string[]; created: string[] }; selected: string | null; onSelect: (p: string) => void; onNew: () => void;
}) {
  const render = (nodes: TreeNode[], depth = 0) => nodes.map((n) => (
    <div key={n.path}>
      <div className={`row ${selected === n.path ? "active" : ""}`} style={{ paddingLeft: 20 + depth * 16 }}
        onClick={() => n.type === "file" && onSelect(n.path)}>
        {n.type === "dir" ? <FolderIcon /> : <FileIcon />}
        <span>{n.name}</span>
        <span className="spacer" />
        {status.modified.includes(n.path) && <span className="dot-mod" />}
        {status.created.includes(n.path) && <span className="badge new">nieuw</span>}
      </div>
      {n.children && render(n.children, depth + 1)}
    </div>
  ));
  return (
    <div className="col tree">
      <div className="eyebrow" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Vault</span>
        <button className="ghost sm" onClick={onNew} style={{ textTransform: "none", letterSpacing: 0 }}>+ nieuw</button>
      </div>
      <div className="tree-list">{tree.length ? render(tree) : <div style={{ padding: "8px 20px", color: "var(--faint)", fontSize: 13 }}>Nog leeg — maak een notitie.</div>}</div>
    </div>
  );
}

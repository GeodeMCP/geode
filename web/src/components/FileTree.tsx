import { useState } from "react";
import type { TreeNode } from "../api";

// Tree glyphs — identical to the marketing site (#ico-folder / #ico-file).
const FolderIcon = () => (
  <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
    <path d="M2 4.4c0-.6.4-1 1-1h3.1l1.3 1.4H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4.4Z" />
  </svg>
);
const FileIcon = () => (
  <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
    <path d="M4 2.5h5l3.2 3.2V13c0 .4-.3.7-.7.7H4c-.4 0-.7-.3-.7-.7V3.2c0-.4.3-.7.7-.7Z" /><path d="M8.8 2.6v3.1h3.1" />
  </svg>
);
const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
);

export function FileTree({ tree, status, selected, onSelect, onCreate }: {
  tree: TreeNode[]; status: { modified: string[]; created: string[] }; selected: string | null; onSelect: (p: string) => void; onCreate: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const toggle = (p: string) => setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const submitNew = () => { const v = name.trim(); if (!v) return; onCreate(v); setCreating(false); setName(""); };

  const render = (nodes: TreeNode[], depth = 0): React.ReactNode => nodes.map((n) => {
    const isDir = n.type === "dir";
    const open = isDir && !collapsed.has(n.path);
    return (
      <div key={n.path}>
        <div className={`row ${isDir && open ? "open" : ""} ${selected === n.path ? "active" : ""}`}
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => (isDir ? toggle(n.path) : onSelect(n.path))}
          aria-label={n.name}>
          <span className="lead" style={{ flex: 1 }}>
            {isDir ? <Chevron /> : <span style={{ width: 14, flex: "none" }} />}
            {isDir ? <FolderIcon /> : <FileIcon />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
          </span>
          {status.modified.includes(n.path) && <span className="badge mod">modified</span>}
          {status.created.includes(n.path) && <span className="badge new">new</span>}
        </div>
        {isDir && open && n.children && render(n.children, depth + 1)}
      </div>
    );
  });

  return (
    <div className="col tree">
      <div className="eyebrow" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Vault</span>
        <button className="ghost sm" onClick={() => setCreating((c) => !c)} style={{ textTransform: "none", letterSpacing: 0 }}>+ New</button>
      </div>
      {creating && (
        <div style={{ padding: "0 14px 8px" }}>
          <input className="input" autoFocus value={name} placeholder="path/to/note"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitNew(); else if (e.key === "Escape") { setCreating(false); setName(""); } }} />
        </div>
      )}
      <div className="tree-list">{tree.length ? render(tree) : <div style={{ padding: "8px 20px", color: "var(--faint)", fontSize: 13 }}>Empty — create a note.</div>}</div>
    </div>
  );
}

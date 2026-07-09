import { useEffect, useState } from "react";
import type { TreeNode } from "../api";
import { isToolPath, isSpecialFolder } from "../fileType";
import { isArtifactPath } from "../artifacts";
import { ColHead } from "./ColHead";

// Persisted set of expanded folder paths — survives refresh (localStorage).
const TREE_STATE_KEY = "geode.tree.expanded";

// All directory paths in the tree — used by expand-all.
const allDirPaths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.type === "dir" ? [n.path, ...allDirPaths(n.children ?? [])] : []));

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
const ToolIcon = () => (
  <svg className="ic tool" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.3 1.7 3.6 9h3.7l-.7 5.3L12.4 7H8.7z" />
  </svg>
);
// backlog = queue of capability gaps → an inbox tray.
const BacklogIcon = () => (
  <svg className="ic backlog" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 9.5 4 4.3c.1-.5.5-.8 1-.8h6c.5 0 .9.3 1 .8l1.5 5.2V12c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1V9.5Z" />
    <path d="M2.5 9.5h3l.8 1.5h3.4l.8-1.5h3" />
  </svg>
);
const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
);

/** Renders the vault file tree with collapsible folders, git-status badges, inline file creation, and per-file delete confirmation. */
export function FileTree({ tree, status, selected, onSelect, onCreate, onDelete, needsInstall }: {
  tree: TreeNode[]; status: { modified: string[]; created: string[] }; selected: string | null;
  onSelect: (p: string) => void; onCreate: (path: string) => void; onDelete: (path: string) => void;
  needsInstall?: Set<string>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(TREE_STATE_KEY); return new Set<string>(raw ? JSON.parse(raw) : []); }
    catch { return new Set<string>(); }
  });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    try { localStorage.setItem(TREE_STATE_KEY, JSON.stringify([...expanded])); } catch { /* ignore */ }
  }, [expanded]);
  const toggle = (p: string) => setExpanded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const toggleAll = () => setExpanded((s) => (s.size ? new Set<string>() : new Set(allDirPaths(tree))));
  const submitNew = () => { const v = name.trim(); if (!v) return; onCreate(v); setCreating(false); setName(""); };
  const cancelNew = () => { setCreating(false); setName(""); };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const dirtyPaths = [...status.modified, ...status.created];
  const dirDirty = (p: string) => dirtyPaths.some((f) => f.startsWith(p + "/"));
  const pending = status.modified.length + status.created.length;
  const hasInstallPending = (needsInstall?.size ?? 0) > 0;

  const render = (nodes: TreeNode[], depth = 0): React.ReactNode => nodes.map((n) => {
    const isDir = n.type === "dir";
    const open = isDir && expanded.has(n.path);
    const gen = isArtifactPath(n.path);
    const toolNeedsInstall = isDir && /^tools\/[^/]+$/.test(n.path) && (needsInstall?.has(n.path.split("/")[1]) ?? false);
    return (
      <div key={n.path}>
        <div className={`row ${isDir && open ? "open" : ""} ${selected === n.path ? "active" : ""} ${gen ? "gen" : ""}`}
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() => (isDir ? toggle(n.path) : onSelect(n.path))}
          aria-label={n.name}>
          <span className="lead" style={{ flex: 1 }}>
            {isDir ? <Chevron /> : <span style={{ width: 14, flex: "none" }} />}
            {isToolPath(n.path) ? <ToolIcon />
              : isDir && n.path === "backlog" ? <BacklogIcon />
              : isDir ? <FolderIcon /> : <FileIcon />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
          </span>
          {confirming === n.path ? (
            <span className="confirm" onClick={stop}>
              <button className="ghost sm danger" onClick={(e) => { stop(e); onDelete(n.path); setConfirming(null); }}>Delete</button>
              <button className="ghost sm" onClick={(e) => { stop(e); setConfirming(null); }}>Cancel</button>
            </span>
          ) : (
            <>
              {status.modified.includes(n.path) && <span className="badge mod">modified</span>}
              {status.created.includes(n.path) && <span className="badge new">new</span>}
              {toolNeedsInstall && <span className="badge install" title="This tool must be installed before it can run">install</span>}
              {isDir && (dirDirty(n.path) || (n.path === "tools" && hasInstallPending)) && <span className="dot-mod" title="Needs attention inside" />}
              {!gen && !isSpecialFolder(n.path) && <button className="del-btn" title={`Delete ${n.name}`} onClick={(e) => { stop(e); setConfirming(n.path); }}><TrashIcon /></button>}
            </>
          )}
        </div>
        {isDir && open && n.children && render(n.children, depth + 1)}
      </div>
    );
  });

  return (
    <div className="col tree">
      <ColHead title="Vault" note={pending > 0 ? <span style={{ color: "#d9a13a" }}>{pending} pending</span> : undefined}>
        <button className="ghost sm" onClick={toggleAll} title={expanded.size ? "Collapse all folders" : "Expand all folders"} style={{ textTransform: "none", letterSpacing: 0 }}>{expanded.size ? "Collapse all" : "Expand all"}</button>
        <button className={`ghost sm${creating ? " on" : ""}`} onClick={() => (creating ? cancelNew() : setCreating(true))} style={{ textTransform: "none", letterSpacing: 0 }}>+ New</button>
      </ColHead>
      {creating && (
        <div className="newfile-row">
          <input className="input" autoFocus value={name} placeholder="path/to/note"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitNew(); else if (e.key === "Escape") cancelNew(); }}
            onBlur={() => { if (!name.trim()) cancelNew(); }} />
          <button className="ghost sm icon" title="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancelNew}>✕</button>
        </div>
      )}
      <div className="tree-list">{tree.length ? render(tree) : <div style={{ padding: "8px 20px", color: "var(--faint)", fontSize: 13 }}>Empty — create a note.</div>}</div>
    </div>
  );
}

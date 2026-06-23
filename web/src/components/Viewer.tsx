import { useEffect, useState } from "react";
import { renderMarkdown, splitFrontmatter } from "../markdown";

// Hide git plumbing; keep hunk headers (rendered subtly) + the real +/- changes.
function cleanDiff(diff: string): string[] {
  return diff.split("\n").filter((l) => !/^(diff --git |index [0-9a-f]|--- |\+\+\+ )/.test(l));
}

export function Viewer({ path, content, diff, dirty, compose, onCommit, onDiscard, onSave }: {
  path: string | null; content: string; diff: string; dirty: boolean;
  compose: { path: string; draft: string } | null;
  onCommit: () => void; onDiscard: () => void; onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  // A brand-new note (compose) opens straight in the editor; otherwise selecting a file shows it read-only.
  useEffect(() => {
    if (compose && compose.path === path) { setDraft(compose.draft); setEditing(true); }
    else setEditing(false);
  }, [path, compose]);

  const startEdit = () => { setDraft(content); setEditing(true); };
  const save = () => { onSave(draft); setEditing(false); setSaved(true); window.setTimeout(() => setSaved(false), 1600); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
  };
  const { fm, body } = splitFrontmatter(content);

  return (
    <div className="col viewer">
      <div className="panel-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="tl"><span /><span /><span /></div>
          <span className="fname">{path ?? "—"}</span>
          {dirty && <span className="uncommitted"><span className="dot-mod" />uncommitted</span>}
          {saved && <span style={{ color: "var(--green)", fontSize: 12.5 }}>Saved</span>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {editing && <><button className="ghost sm" onClick={() => setEditing(false)}>Cancel</button><button className="btn sm" onClick={save}>Save</button></>}
          {!editing && path && <button className="ghost sm" onClick={startEdit}>Edit</button>}
          {!editing && dirty && <><button className="ghost sm" onClick={onDiscard}>Discard</button><button className="btn sm" onClick={onCommit}>Commit</button></>}
        </div>
      </div>

      {editing ? (
        <textarea className="input" style={{ flex: 1, margin: 16, fontFamily: "Geist Mono, monospace", fontSize: 13, resize: "none" }}
          value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} autoFocus />
      ) : dirty ? (
        <div className="pre">{(() => {
          const ls = cleanDiff(diff);
          return ls.length
            ? ls.map((l, i) => l.startsWith("@@")
              ? <div key={i} style={{ color: "var(--faint)" }}>{l}</div>
              : <div key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>{l || " "}</div>)
            : <div style={{ color: "var(--faint)" }}>No changes.</div>;
        })()}</div>
      ) : path ? (
        <div className="doc">
          {(fm.title || fm.type || fm.tags) && (
            <div className="doc-fm">
              {fm.type && <span className="chip">{fm.type}</span>}
              {fm.title && <span style={{ color: "var(--muted)", fontSize: 13 }}>{fm.title}</span>}
              {fm.tags && <span style={{ color: "var(--faint)", fontSize: 12 }}>{fm.tags}</span>}
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        </div>
      ) : (
        <div className="pre"><div style={{ color: "var(--faint)" }}>Select a file or ask the agent.</div></div>
      )}
    </div>
  );
}

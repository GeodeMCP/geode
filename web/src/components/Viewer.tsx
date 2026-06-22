import { useEffect, useState } from "react";
import { renderMarkdown, splitFrontmatter } from "../markdown";

export function Viewer({ path, content, diff, dirty, onCommit, onDiscard, onSave }: {
  path: string | null; content: string; diff: string; dirty: boolean;
  onCommit: () => void; onDiscard: () => void; onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => { setEditing(false); }, [path]);

  const startEdit = () => { setDraft(content); setEditing(true); };
  const save = () => { onSave(draft); setEditing(false); };
  const { fm, body } = splitFrontmatter(content);

  return (
    <div className="col viewer">
      <div className="panel-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="tl"><span /><span /><span /></div>
          <span className="fname">{path ?? "—"}</span>
          {dirty && <span className="uncommitted"><span className="dot-mod" />niet-gecommit</span>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {editing && <><button className="ghost sm" onClick={() => setEditing(false)}>Annuleer</button><button className="btn sm" onClick={save}>Opslaan</button></>}
          {!editing && path && <button className="ghost sm" onClick={startEdit}>Bewerk</button>}
          {!editing && dirty && <><button className="ghost sm" onClick={onDiscard}>Verwerp</button><button className="btn sm" onClick={onCommit}>Commit</button></>}
        </div>
      </div>

      {editing ? (
        <textarea className="input" style={{ flex: 1, margin: 16, fontFamily: "Geist Mono, monospace", fontSize: 13, resize: "none" }}
          value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      ) : dirty ? (
        <div className="pre">{diff
          ? diff.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : ""}>{l || " "}</div>)
          : <div style={{ color: "var(--faint)" }}>Geen wijzigingen.</div>}</div>
      ) : path ? (
        <div className="doc" style={{ overflow: "auto", padding: "18px 22px" }}>
          {(fm.title || fm.type || fm.tags) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {fm.type && <span className="chip">{fm.type}</span>}
              {fm.title && <span style={{ color: "var(--muted)", fontSize: 13 }}>{fm.title}</span>}
              {fm.tags && <span style={{ color: "var(--faint)", fontSize: 12 }}>{fm.tags}</span>}
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        </div>
      ) : (
        <div className="pre"><div style={{ color: "var(--faint)" }}>Selecteer een bestand of stel de agent een vraag.</div></div>
      )}
    </div>
  );
}

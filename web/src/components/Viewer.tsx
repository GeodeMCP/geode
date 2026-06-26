import { useEffect, useState } from "react";
import { renderMarkdown, splitFrontmatter } from "../markdown";
import { fileType, prettyJson } from "../fileType";
import { resolveLink } from "../links";
import { CodeEditor } from "./CodeEditor";
import { ColHead } from "./ColHead";

/** Strips git plumbing header lines from a diff, keeping hunk headers and actual +/- change lines. */
function cleanDiff(diff: string): string[] {
  return diff.split("\n").filter((l) => !/^(diff --git |index [0-9a-f]|--- |\+\+\+ )/.test(l));
}

/** Renders the file viewer column: Formatted (Markdown) / Source (code) / Edit, plus the git diff for dirty files. */
export function Viewer({ path, content, diff, dirty, compose, onCommit, onDiscard, onSave, onOpenFile }: {
  path: string | null; content: string; diff: string; dirty: boolean;
  compose: { path: string; draft: string } | null;
  onCommit: () => void; onDiscard: () => void; onSave: (text: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const ft = path ? fileType(path) : { kind: "text" as const, hasFormatted: false };

  // A brand-new note (compose) opens straight in the editor; selecting a file resets to the formatted/read view.
  useEffect(() => {
    if (compose && compose.path === path) { setDraft(compose.draft); setEditing(true); }
    else setEditing(false);
    setShowSource(false);
  }, [path, compose]);

  const startEdit = () => { setDraft(ft.kind === "json" ? prettyJson(content) : content); setEditing(true); };
  const save = (text?: string) => {
    onSave(text ?? draft); setEditing(false); setShowSource(false); setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };
  const onLinkClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    const link = resolveLink(path ?? "", href);
    if (link.kind === "internal") { e.preventDefault(); onOpenFile?.(link.path); }
    else if (link.kind === "external") { e.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
  };
  const { fm, body } = splitFrontmatter(content);
  const showToggle = !!path && !editing && !dirty && ft.hasFormatted;

  return (
    <div className="col viewer">
      <ColHead title="File editor" note={path ?? "—"}>
        {dirty && <span className="uncommitted"><span className="dot-mod" />uncommitted</span>}
        {saved && <span style={{ color: "var(--green)", fontSize: 12.5 }}>Saved</span>}
        {showToggle && (
          <span className="seg">
            <button className={!showSource ? "on" : ""} onClick={() => setShowSource(false)}>Formatted</button>
            <button className={showSource ? "on" : ""} onClick={() => setShowSource(true)}>Source</button>
          </span>
        )}
        {editing && <><button className="ghost sm" onClick={() => setEditing(false)}>Cancel</button><button className="btn sm" onClick={() => save()}>Save</button></>}
        {!editing && path && <button className="ghost sm" onClick={startEdit}>Edit</button>}
        {!editing && dirty && <><button className="ghost sm" onClick={onDiscard}>Discard</button><button className="btn sm" onClick={onCommit}>Commit</button></>}
      </ColHead>

      {editing ? (
        <CodeEditor value={draft} kind={ft.kind} editable onChange={setDraft} onSave={(text) => save(text)} onCancel={() => setEditing(false)} />
      ) : dirty ? (
        <div className="pre">{(() => {
          const ls = cleanDiff(diff);
          return ls.length
            ? ls.map((l, i) => l.startsWith("@@")
              ? <div key={i} style={{ color: "var(--faint)" }}>{l}</div>
              : <div key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}>{l || " "}</div>)
            : <div style={{ color: "var(--faint)" }}>No changes.</div>;
        })()}</div>
      ) : path && ft.kind === "markdown" && !showSource ? (
        <div className="doc md" onClick={onLinkClick}>
          {(fm.title || fm.type || fm.tags) && (
            <div className="doc-fm">
              {fm.type && <span className="chip">{fm.type}</span>}
              {fm.title && <span style={{ color: "var(--muted)", fontSize: 13 }}>{fm.title}</span>}
              {fm.tags && <span style={{ color: "var(--faint)", fontSize: 12 }}>{fm.tags}</span>}
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        </div>
      ) : path ? (
        <CodeEditor value={ft.kind === "json" ? prettyJson(content) : content} kind={ft.kind} editable={false} />
      ) : (
        <div className="pre"><div style={{ color: "var(--faint)" }}>Select a file or ask the agent.</div></div>
      )}
    </div>
  );
}

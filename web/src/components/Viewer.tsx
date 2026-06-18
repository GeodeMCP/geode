export function Viewer({ path, diff, dirty, onCommit, onDiscard }: {
  path: string | null; diff: string; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  return (
    <div className="col viewer">
      <div className="panel-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="tl"><span /><span /><span /></div>
          <span className="fname">{path ?? "—"}</span>
          {dirty && <span className="uncommitted"><span className="dot-mod" />niet-gecommit</span>}
        </div>
        {dirty && <div style={{ display: "flex", gap: 10 }}><button className="ghost" onClick={onDiscard}>Verwerp</button><button className="btn" onClick={onCommit}>Commit</button></div>}
      </div>
      <div className="pre">
        {diff ? diff.split("\n").map((l, i) => (
          <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : ""}>{l || " "}</div>
        )) : <div style={{ color: "var(--faint)" }}>Selecteer een bestand of stel de agent een vraag.</div>}
      </div>
    </div>
  );
}

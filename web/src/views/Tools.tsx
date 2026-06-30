import { useEffect, useState } from "react";
import { api, type ToolView } from "../api";
/** Renders the Tools view: each tool with its type, connections (configured status) and actions, with a test runner. */
export function Tools() {
  const [list, setList] = useState<ToolView[]>([]);
  const [open, setOpen] = useState<ToolView | null>(null);
  const [result, setResult] = useState<string>("");
  useEffect(() => { api.tools().then(setList).catch(() => setList([])); }, []);
  const test = async (action: string) => {
    setResult("…");
    try { setResult(JSON.stringify(await api.testAction(open!.id, action, {}), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };
  if (open) return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <button className="ghost" onClick={() => { setOpen(null); setResult(""); }}>← Tools</button>
      <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em" }}>{open.name} <span className="chip">{open.type}</span></h2>
      <p style={{ color: "var(--muted)" }}>{open.description}</p>
      <div className="eyebrow" style={{ marginTop: 16 }}>Actions</div>
      {open.actions.map((a) => (
        <div key={a.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{a.name}</span>
          <button className="btn sm" onClick={() => test(a.name)}>Test</button>
        </div>
      ))}
      {result && <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10 }}>{result}</pre>}
      <div className="eyebrow" style={{ marginTop: 16 }}>Connections</div>
      {open.connections.length === 0 && <p style={{ color: "var(--faint)" }}>No connections.</p>}
      {open.connections.map((c) => (
        <div key={c.label} className="card" style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{c.label}{c.description ? ` — ${c.description}` : ""}</span>
          <span className="chip" style={c.configured ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>{c.configured ? "configured" : "needs setup"}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Tools</div>
      {list.length === 0 && <p style={{ color: "var(--faint)" }}>No tools yet.</p>}
      {list.map((t) => (
        <div key={t.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, cursor: "pointer" }} onClick={() => setOpen(t)}>
          <strong style={{ flex: 1 }}>{t.id} <span className="chip">{t.type}</span></strong>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{t.connections.filter((c) => c.configured).length}/{t.connections.length} connections</span>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, type IntegrationView } from "../api";
/** Renders the Integrations view listing configured integrations with a detail panel showing actions, test results, and required secret status. */
export function Integrations() {
  const [list, setList] = useState<IntegrationView[]>([]);
  const [open, setOpen] = useState<IntegrationView | null>(null);
  const [result, setResult] = useState<string>("");
  useEffect(() => { api.integrations().then(setList).catch(() => setList([])); }, []);
  const test = async (action: string) => {
    setResult("…");
    try { setResult(JSON.stringify(await api.testAction(open!.name, action, {}), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };
  if (open) return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <button className="ghost" onClick={() => { setOpen(null); setResult(""); }}>← Integrations</button>
      <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em" }}>{open.name} <span className="chip">{open.type}</span></h2>
      <p style={{ color: "var(--muted)" }}>{open.description}</p>
      <div className="eyebrow" style={{ marginTop: 16 }}>Actions</div>
      {open.actions.map((a) => (
        <div key={a.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{a.name}</span>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{a.method}</span>
          <button className="btn sm" onClick={() => test(a.name)}>Test</button>
        </div>
      ))}
      {result && <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10 }}>{result}</pre>}
      {result && <p style={{ color: "var(--faint)", fontSize: 12, marginTop: 6 }}>Note: an echo endpoint can reflect an injected secret in this result.</p>}
      <div className="eyebrow" style={{ marginTop: 16 }}>Required secrets</div>
      {open.requiredSecrets.map((s) => (
        <div key={s.ref} className="card" style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{s.ref}</span>
          <span className="chip" style={s.set ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>{s.set ? "set" : "missing"}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Integrations</div>
      {list.length === 0 && <p style={{ color: "var(--faint)" }}>No integrations yet.</p>}
      {list.map((i) => (
        <div key={i.name} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, cursor: "pointer" }} onClick={() => setOpen(i)}>
          <strong style={{ flex: 1 }}>{i.name} <span className="chip">{i.type}</span></strong>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{i.requiredSecrets.filter((s) => s.set).length}/{i.requiredSecrets.length} secrets</span>
        </div>
      ))}
    </div>
  );
}

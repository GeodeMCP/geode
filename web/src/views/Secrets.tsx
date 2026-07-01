import { useEffect, useState } from "react";
import { api, type ToolView } from "../api";
/** Renders the Secrets view: stored secret refs (values never shown), guided add-via-picker, and delete. */
export function Secrets() {
  const [items, setItems] = useState<{ ref: string; requiredBy: string[] }[]>([]);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [link, setLink] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [toolId, setToolId] = useState("");
  const [conn, setConn] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const refresh = () => api.secrets().then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); api.tools().then(setTools).catch(() => setTools([])); }, []);

  const tool = tools.find((t) => t.id === toolId);
  // The ref format is <tool>__<connection>__<KEY> — composed for the user, never hand-typed.
  const composedRef = toolId && conn && secretKey ? `${toolId}__${conn}__${secretKey}` : "";
  const openAdd = () => { setAdding(true); setToolId(""); setConn(""); setSecretKey(""); };
  const cancelAdd = () => { setAdding(false); setToolId(""); setConn(""); setSecretKey(""); };
  const pickTool = (id: string) => {
    setToolId(id);
    const t = tools.find((x) => x.id === id);
    setConn(t && t.connections.length === 1 ? t.connections[0].label : "");
    setSecretKey(t && t.requires.length === 1 ? t.requires[0] : "");
  };
  const submitAdd = async () => {
    if (!composedRef) return;
    const { url } = await api.secretLink(composedRef);
    setLink(url);
    cancelAdd();
  };
  const del = async (r: string) => { await api.deleteSecret(r); refresh(); };

  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="eyebrow" style={{ flex: 1 }}>Secrets <span style={{ color: "var(--faint)", textTransform: "none", letterSpacing: 0 }}>— values are never shown</span></div>
        {!adding && <button className="btn sm" onClick={openAdd}>Add secret</button>}
      </div>
      {adding && (
        <div className="card" style={{ display: "block", margin: "12px 0" }}>
          {tools.length === 0 ? (
            <p style={{ color: "var(--faint)", margin: 0 }}>No tools yet — add a tool first; its connections&apos; secrets appear here.</p>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>Tool</span>
                  <select className="input" value={toolId} onChange={(e) => pickTool(e.currentTarget.value)}>
                    <option value="">Select…</option>
                    {tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>Connection</span>
                  <select className="input" value={conn} disabled={!tool} onChange={(e) => setConn(e.currentTarget.value)}>
                    <option value="">Select…</option>
                    {tool?.connections.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>Key</span>
                  <select className="input" value={secretKey} disabled={!tool} onChange={(e) => setSecretKey(e.currentTarget.value)}>
                    <option value="">Select…</option>
                    {tool?.requires.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              </div>
              {tool && tool.connections.length === 0 && <p style={{ color: "#d9a13a", fontSize: 12, margin: "8px 0 0" }}>This tool has no connections defined.</p>}
              {tool && tool.requires.length === 0 && <p style={{ color: "var(--faint)", fontSize: 12, margin: "8px 0 0" }}>This tool needs no secrets.</p>}
              {composedRef && <p style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, color: "var(--emerald-300)", margin: "10px 0 0" }}>{composedRef}</p>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn sm" onClick={submitAdd} disabled={!composedRef}>Add</button>
                <button className="ghost sm" onClick={cancelAdd}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
      {link && <div className="card" style={{ display: "block", margin: "12px 0", borderColor: "rgba(52,211,153,.4)" }}>
        <p style={{ margin: "0 0 6px", color: "var(--muted)", fontSize: 13 }}>Open this one-time link to enter the value (valid 10 min):</p>
        <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </div>}
      {items.length === 0 && <p style={{ color: "var(--faint)" }}>No secrets yet.</p>}
      {items.map((s) => (
        <div key={s.ref} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{s.ref}</span>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{s.requiredBy.length ? `used by ${s.requiredBy.join(", ")}` : "unused"}</span>
          <button className="ghost" onClick={() => del(s.ref)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

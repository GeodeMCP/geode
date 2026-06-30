import { useEffect, useRef, useState } from "react";
import { api } from "../api";
/** Renders the Secrets view listing stored secret references (values never shown) with add-via-one-time-link and delete actions. */
export function Secrets() {
  const [items, setItems] = useState<{ ref: string; requiredBy: string[] }[]>([]);
  const [link, setLink] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [refValue, setRefValue] = useState("");
  const [refError, setRefError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const refresh = () => api.secrets().then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  const openAdd = () => { setAdding(true); setRefValue(""); setRefError(""); setTimeout(() => inputRef.current?.focus(), 0); };
  const cancelAdd = () => { setAdding(false); setRefValue(""); setRefError(""); };
  const submitAdd = async () => {
    const ref = refValue.trim();
    if (!ref) { setRefError("Secret name is required."); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) { setRefError("Only letters, digits, _ and - are allowed."); return; }
    setRefError("");
    const { url } = await api.secretLink(ref);
    setLink(url);
    cancelAdd();
  };
  const del = async (ref: string) => { await api.deleteSecret(ref); refresh(); };
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="eyebrow" style={{ flex: 1 }}>Secrets <span style={{ color: "var(--faint)", textTransform: "none", letterSpacing: 0 }}>— values are never shown</span></div>
        {!adding && <button className="btn sm" onClick={openAdd}>Add secret</button>}
      </div>
      {adding && (
        <div className="card" style={{ display: "block", margin: "12px 0" }}>
          <input
            ref={inputRef}
            className="input"
            placeholder="<tool>__<connection>__<KEY> (e.g. httpbin__default__DEMO_KEY)"
            value={refValue}
            onChange={(e) => setRefValue(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); if (e.key === "Escape") cancelAdd(); }}
          />
          {refError && <p style={{ color: "var(--amber)", fontSize: 12, margin: "6px 0 0" }}>{refError}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn sm" onClick={submitAdd}>Add</button>
            <button className="ghost sm" onClick={cancelAdd}>Cancel</button>
          </div>
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

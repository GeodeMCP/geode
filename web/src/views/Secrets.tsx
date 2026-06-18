import { useEffect, useState } from "react";
import { api } from "../api";
export function Secrets() {
  const [items, setItems] = useState<{ ref: string; requiredBy: string[] }[]>([]);
  const [link, setLink] = useState<string>("");
  const refresh = () => api.secrets().then(setItems).catch(() => setItems([]));
  useEffect(() => { refresh(); }, []);
  const add = async () => {
    const ref = window.prompt("Naam van het secret (bv. NOTION_TOKEN)")?.trim();
    if (!ref) return;
    const { url } = await api.secretLink(ref); setLink(url);
  };
  const del = async (ref: string) => { await api.deleteSecret(ref); refresh(); };
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="eyebrow" style={{ flex: 1 }}>Secrets <span style={{ color: "var(--faint)", textTransform: "none", letterSpacing: 0 }}>— waardes worden nooit getoond</span></div>
        <button className="btn sm" onClick={add}>Secret toevoegen</button>
      </div>
      {link && <div className="card" style={{ display: "block", margin: "12px 0", borderColor: "rgba(52,211,153,.4)" }}>
        <p style={{ margin: "0 0 6px", color: "var(--muted)", fontSize: 13 }}>Open deze eenmalige link om de waarde in te voeren (10 min geldig):</p>
        <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </div>}
      {items.length === 0 && <p style={{ color: "var(--faint)" }}>Nog geen secrets.</p>}
      {items.map((s) => (
        <div key={s.ref} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{s.ref}</span>
          <span style={{ color: "var(--faint)", fontSize: 12 }}>{s.requiredBy.length ? `gebruikt door ${s.requiredBy.join(", ")}` : "ongebruikt"}</span>
          <button className="ghost" onClick={() => del(s.ref)}>Verwijder</button>
        </div>
      ))}
    </div>
  );
}

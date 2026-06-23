import { useEffect, useState } from "react";
import { api } from "../api";
export function Capabilities() {
  const [cap, setCap] = useState<Awaited<ReturnType<typeof api.capabilities>> | null>(null);
  useEffect(() => { api.capabilities().then(setCap).catch(() => setCap({ integrations: [], recipes: [] })); }, []);
  if (!cap) return null;
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Integrations</div>
      {cap.integrations.length === 0 && <p style={{ color: "var(--faint)" }}>No integrations yet.</p>}
      {cap.integrations.map((i) => (
        <div key={i.name} className="card" style={{ display: "block", marginBottom: 10 }}>
          <strong>{i.name}</strong> <span style={{ color: "var(--muted)" }}>— {i.description}</span>
          <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 12, color: "var(--emerald-300)", marginTop: 4 }}>{i.actions.join(" · ")}</div>
        </div>
      ))}
      <div className="eyebrow" style={{ marginTop: 24 }}>Recipes &amp; skills</div>
      {cap.recipes.length === 0 && <p style={{ color: "var(--faint)" }}>No recipes yet.</p>}
      {cap.recipes.map((r) => (
        <div key={r.path} className="card" style={{ display: "block", marginBottom: 10 }}><strong>{r.title}</strong> <span style={{ color: "var(--muted)" }}>— {r.description}</span></div>
      ))}
    </div>
  );
}

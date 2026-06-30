import { useEffect, useState } from "react";
import { api } from "../api";
/** Renders the Capabilities view listing available tools and their actions alongside vault recipes and skills. */
export function Capabilities() {
  const [cap, setCap] = useState<Awaited<ReturnType<typeof api.capabilities>> | null>(null);
  useEffect(() => { api.capabilities().then(setCap).catch(() => setCap({ tools: [], recipes: [] })); }, []);
  if (!cap) return null;
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Tools</div>
      {cap.tools.length === 0 && <p style={{ color: "var(--faint)" }}>No tools yet.</p>}
      {cap.tools.map((t) => (
        <div key={t.id} className="card" style={{ display: "block", marginBottom: 10 }}>
          <strong>{t.id}</strong> <span className="chip">{t.type}</span> <span style={{ color: "var(--muted)" }}>— {t.description}</span>
          <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 12, color: "var(--emerald-300)", marginTop: 4 }}>{t.actions.join(" · ")}</div>
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

import { useEffect, useState } from "react";
import { api } from "../api";
export function Artifacts() {
  const [items, setItems] = useState<{ path: string }[]>([]);
  const [shared, setShared] = useState<Record<string, string>>({});
  useEffect(() => { api.artifacts().then(setItems).catch(() => setItems([])); }, []);
  const share = async (path: string) => { const { url } = await api.artifactPublicLink(path); setShared((s) => ({ ...s, [path]: url })); };
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Artifacts</div>
      {items.length === 0 && <p style={{ color: "var(--faint)" }}>No artifacts yet.</p>}
      {items.map((a) => (
        <div key={a.path} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <span className="fname" style={{ flex: 1 }}>{a.path}</span>
          <a className="ghost" href={api.artifactDownload(a.path)} target="_blank" rel="noreferrer">Download</a>
          <button className="ghost" onClick={() => share(a.path)}>Share link</button>
          {shared[a.path] && <input className="input" readOnly value={shared[a.path]} style={{ flexBasis: "100%" }} onFocus={(e) => e.currentTarget.select()} />}
        </div>
      ))}
    </div>
  );
}

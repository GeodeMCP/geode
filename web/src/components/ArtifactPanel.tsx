import { useState } from "react";
import { api } from "../api";

/** Viewer panel for one generated artifact: download + shareable public link. `path` is relative to artifactsDir. */
export function ArtifactPanel({ path }: { path: string }) {
  const [shared, setShared] = useState<string>("");
  const share = async () => { const { url } = await api.artifactPublicLink(path); setShared(url); };
  return (
    <div className="pre" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "var(--muted)" }}>Generated artifact — not part of the committed vault.</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="fname" style={{ flex: 1 }}>{path}</span>
        <a className="ghost" href={api.artifactDownload(path)} target="_blank" rel="noreferrer">Download</a>
        <button className="ghost" onClick={share}>Share link</button>
      </div>
      {shared && <input className="input" readOnly value={shared} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}

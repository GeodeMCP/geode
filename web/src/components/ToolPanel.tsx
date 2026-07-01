import { useEffect, useState } from "react";
import { api, type ToolView } from "../api";

/** Live formatted panel for one vault tool: install & trust, actions/test, connections — overlaid from /api/tools/:id (not the manifest file). */
export function ToolPanel({ id }: { id: string }) {
  const [tool, setTool] = useState<ToolView | null>(null);
  const [result, setResult] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = () => api.tool(id).then((t) => { setTool(t); setLoadError(""); }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    let live = true;
    setResult(""); setConfirmInstall(false); setInstallError(""); setTool(null);
    api.tool(id)
      .then((t) => { if (live) { setTool(t); setLoadError(""); } })
      .catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  const test = async (action: string, params: string[]) => {
    setResult("…");
    const values: Record<string, string> = {};
    for (const p of params) values[p] = inputs[`${action}::${p}`] ?? "";
    try { setResult(JSON.stringify(await api.testAction(id, action, values), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };
  const install = async () => {
    setBusy(true); setInstallError("");
    try { await api.installTool(id); await load(); setConfirmInstall(false); }
    catch (e) { setInstallError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const uninstall = async () => {
    setBusy(true); setInstallError("");
    try { await api.uninstallTool(id); await load(); }
    catch (e) { setInstallError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (loadError) return (
    <div className="toolpanel" style={{ overflow: "auto", padding: "20px 22px" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Couldn&apos;t load this tool</div>
      <pre className="tp-error">{loadError}</pre>
      <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 8 }}>Fix the manifest via Source / Edit and save — the panel reloads.</p>
    </div>
  );
  if (!tool) return <div className="toolpanel" style={{ padding: "20px 22px", color: "var(--faint)" }}>Loading…</div>;
  const isCli = tool.type === "cli";
  const perms = tool.permissions;
  return (
    <div className="toolpanel" style={{ overflow: "auto", padding: "20px 22px" }}>
      <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em", marginTop: 0 }}>
        {tool.name} <span className="chip">{tool.type}</span>
        {isCli && (
          <span className="chip" style={tool.installed ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)", marginLeft: 6 } : { color: "var(--amber)", marginLeft: 6 }}>
            {tool.installed ? "installed" : "not installed"}
          </span>
        )}
      </h2>
      <p style={{ color: "var(--muted)" }}>{tool.description}</p>

      {isCli && !tool.installed && !confirmInstall && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setConfirmInstall(true)}>Install &amp; trust</button>
      )}
      {isCli && !tool.installed && confirmInstall && (
        <div className="card" style={{ display: "block", marginTop: 8, padding: "14px 16px" }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Permissions requested</div>
          {perms ? (
            <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 10 }}>{JSON.stringify(perms, null, 2)}</pre>
          ) : (
            <p style={{ color: "var(--faint)", marginBottom: 10 }}>No special permissions declared.</p>
          )}
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>Confirming will build the Docker image and trust this tool with the permissions above.</p>
          {installError && <pre className="tp-error">{installError}</pre>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" onClick={install} disabled={busy}>{busy ? "Installing…" : "Confirm install"}</button>
            <button className="ghost sm" onClick={() => { setConfirmInstall(false); setInstallError(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {isCli && tool.installed && (
        <div style={{ marginTop: 8 }}>
          {installError && <pre className="tp-error">{installError}</pre>}
          <button className="ghost sm" onClick={uninstall} disabled={busy}>{busy ? "Uninstalling…" : "Uninstall"}</button>
        </div>
      )}

      <div className="eyebrow" style={{ marginTop: 16 }}>Actions</div>
      {tool.actions.map((a) => (
        <div key={a.name} className="card" style={{ display: "block", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="fname" style={{ flex: 1 }}>{a.name}</span>
            <button className="btn sm" onClick={() => test(a.name, a.params)}>Test</button>
          </div>
          {a.params.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {a.params.map((p) => (
                <label key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="fname" style={{ flex: "0 0 120px", color: "var(--faint)" }}>{p}</span>
                  <input className="input" value={inputs[`${a.name}::${p}`] ?? ""} placeholder={`params.${p}`}
                    onChange={(e) => setInputs((s) => ({ ...s, [`${a.name}::${p}`]: e.target.value }))} />
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      {result && <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10, maxHeight: 280 }}>{result}</pre>}
      <div className="eyebrow" style={{ marginTop: 16 }}>Connections</div>
      {tool.connections.length === 0 && <p style={{ color: "var(--faint)" }}>No connections.</p>}
      {tool.connections.map((c) => (
        <div key={c.label} className="card" style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <span className="fname" style={{ flex: 1 }}>{c.label}{c.description ? ` — ${c.description}` : ""}</span>
          <span className="chip" style={c.configured ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>{c.configured ? "configured" : "needs setup"}</span>
        </div>
      ))}
    </div>
  );
}

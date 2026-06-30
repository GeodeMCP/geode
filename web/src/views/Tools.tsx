import { useEffect, useState } from "react";
import { api, type ToolView } from "../api";
/** Renders the Tools view: each tool with its type, connections (configured status) and actions, with a test runner. */
export function Tools() {
  const [list, setList] = useState<ToolView[]>([]);
  const [open, setOpen] = useState<ToolView | null>(null);
  const [result, setResult] = useState<string>("");
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState<string>("");

  const reload = () => api.tools().then(setList).catch(() => setList([]));
  useEffect(() => { reload(); }, []);

  const test = async (action: string) => {
    setResult("…");
    try { setResult(JSON.stringify(await api.testAction(open!.id, action, {}), null, 2)); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
  };

  const install = async () => {
    setBusy(true); setInstallError("");
    try {
      await api.installTool(open!.id);
      const updated = await api.tool(open!.id);
      setOpen(updated);
      reload();
      setConfirmInstall(false);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const uninstall = async () => {
    setBusy(true); setInstallError("");
    try {
      await api.uninstallTool(open!.id);
      const updated = await api.tool(open!.id);
      setOpen(updated);
      reload();
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  if (open) {
    const isCli = open.type === "cli";
    const perms = open.permissions;
    return (
      <div style={{ overflow: "auto", padding: "24px 28px" }}>
        <button className="ghost" onClick={() => { setOpen(null); setResult(""); setConfirmInstall(false); setInstallError(""); }}>← Tools</button>
        <h2 style={{ fontFamily: "Instrument Sans", fontWeight: 600, letterSpacing: "-.02em" }}>
          {open.name} <span className="chip">{open.type}</span>
          {isCli && (
            <span className="chip" style={open.installed ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)", marginLeft: 6 } : { color: "var(--amber)", marginLeft: 6 }}>
              {open.installed ? "installed" : "not installed"}
            </span>
          )}
        </h2>
        <p style={{ color: "var(--muted)" }}>{open.description}</p>

        {isCli && !open.installed && !confirmInstall && (
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setConfirmInstall(true)}>Install &amp; trust</button>
        )}

        {isCli && !open.installed && confirmInstall && (
          <div className="card" style={{ marginTop: 8, padding: "14px 16px" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Permissions requested</div>
            {perms ? (
              <pre className="pre" style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 10 }}>{JSON.stringify(perms, null, 2)}</pre>
            ) : (
              <p style={{ color: "var(--faint)", marginBottom: 10 }}>No special permissions declared.</p>
            )}
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
              Confirming will build the Docker image and trust this tool with the permissions above.
            </p>
            {installError && <p style={{ color: "var(--red, #f87171)", fontSize: 13, marginBottom: 8 }}>{installError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn sm" onClick={install} disabled={busy}>{busy ? "Installing…" : "Confirm install"}</button>
              <button className="ghost sm" onClick={() => { setConfirmInstall(false); setInstallError(""); }}>Cancel</button>
            </div>
          </div>
        )}

        {isCli && open.installed && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            {installError && <span style={{ color: "var(--red, #f87171)", fontSize: 13 }}>{installError}</span>}
            <button className="ghost sm" onClick={uninstall} disabled={busy}>{busy ? "Uninstalling…" : "Uninstall"}</button>
          </div>
        )}

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
  }
  return (
    <div style={{ overflow: "auto", padding: "24px 28px" }}>
      <div className="eyebrow">Tools</div>
      {list.length === 0 && <p style={{ color: "var(--faint)" }}>No tools yet.</p>}
      {list.map((t) => (
        <div key={t.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, cursor: "pointer" }} onClick={() => setOpen(t)}>
          <strong style={{ flex: 1 }}>{t.id} <span className="chip">{t.type}</span></strong>
          {t.type === "cli" && (
            <span className="chip" style={t.installed ? { color: "var(--green)", borderColor: "rgba(52,211,153,.4)" } : { color: "var(--amber)" }}>
              {t.installed ? "installed" : "not installed"}
            </span>
          )}
          {t.type !== "cli" && <span style={{ color: "var(--faint)", fontSize: 12 }}>{t.connections.filter((c) => c.configured).length}/{t.connections.length} connections</span>}
        </div>
      ))}
    </div>
  );
}

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
  const approve = async (host: string) => { try { await api.approveHost(id, host); await load(); } catch { /* surfaced on reload */ } };
  const revoke = async (host: string) => { try { await api.revokeHost(id, host); await load(); } catch { /* surfaced on reload */ } };

  if (loadError) return (
    <div className="tp">
      <header className="tp-head">
        <div className="na-eyebrow">Couldn&apos;t load this tool</div>
      </header>
      <div className="tp-body">
        <pre className="tp-code err">{loadError}</pre>
        <p className="tp-hint">Fix the manifest via Source / Edit and save — the panel reloads.</p>
      </div>
    </div>
  );
  if (!tool) return <div className="tp tp-loading">Loading…</div>;

  const setupConnection = async (label: string) => {
    for (const k of tool.requires) {
      const ref = `${id}__${label}__${k}`;
      try {
        const { url } = await api.secretLink(ref);
        window.open(url, "_blank", "noopener");
      } catch { /* ignore; user can use Secrets page */ }
    }
  };

  const isCli = tool.type === "cli";
  const perms = tool.permissions;
  return (
    <div className="tp">
      <header className="tp-head">
        <div className="tp-title">
          <h2>{tool.name}</h2>
          <span className="tp-type">{tool.type}</span>
          {isCli && <span className={`tp-status ${tool.installed ? "ok" : "warn"}`}>{tool.installed ? "installed" : "not installed"}</span>}
        </div>
        {tool.description && <p className="tp-desc">{tool.description}</p>}
        {isCli && !tool.installed && !confirmInstall && (
          <button className="btn sm" onClick={() => setConfirmInstall(true)}>Install &amp; trust</button>
        )}
        {isCli && tool.installed && (
          <div className="tp-trailing">
            {installError && <pre className="tp-code err">{installError}</pre>}
            <button className="ghost sm" onClick={uninstall} disabled={busy}>{busy ? "Uninstalling…" : "Uninstall"}</button>
          </div>
        )}
      </header>

      <div className="tp-body">
        {isCli && !tool.installed && confirmInstall && (
          <section className="tp-trust">
            <div className="na-glabel">Permissions requested</div>
            {perms
              ? <pre className="tp-code">{JSON.stringify(perms, null, 2)}</pre>
              : <p className="tp-hint">No special permissions declared.</p>}
            <p className="tp-hint">Confirming builds the Docker image and trusts this tool with the permissions above.</p>
            {installError && <pre className="tp-code err">{installError}</pre>}
            <div className="tp-row">
              <button className="btn sm" onClick={install} disabled={busy}>{busy ? "Installing…" : "Confirm install"}</button>
              <button className="ghost sm" onClick={() => { setConfirmInstall(false); setInstallError(""); }}>Cancel</button>
            </div>
          </section>
        )}

        <section className="tp-section">
          <div className="na-glabel">Connections <span className="na-count">{tool.connections.length}</span></div>
          {tool.connections.length === 0 && <p className="tp-hint">No connections.</p>}
          {tool.connections.map((c) => (
            <div key={c.label} className="tp-conn">
              <div className="tp-conn-main">
                <b>{c.title || c.label}</b>
                {c.description && <span className="tp-conn-desc">{c.description}</span>}
              </div>
              <span className={`tp-status ${c.configured ? "ok" : "warn"}`}>{c.configured ? "configured" : "needs setup"}</span>
              {!c.configured && tool.requires.length > 0 && (
                <button className="ghost sm" onClick={() => setupConnection(c.label)}>Set secret</button>
              )}
            </div>
          ))}
          {tool.connections.length > 0 && tool.requires.length > 0 && (
            <p className="tp-hint" style={{ marginTop: 4 }}>Use the Set secret button to open a one-time entry link. Full list on the Secrets page.</p>
          )}
        </section>

        <section className="tp-section">
          <div className="na-glabel">Hosts <span className="na-count">{tool.hosts.approved.length + tool.hosts.pending.length}</span></div>
          {tool.hosts.approved.length === 0 && tool.hosts.pending.length === 0 && <p className="tp-hint">This tool declares no external hosts.</p>}
          {tool.hosts.pending.map((h) => (
            <div key={h} className="tp-conn">
              <div className="tp-conn-main"><b>{h}</b></div>
              <span className="tp-status warn">pending</span>
              <button className="btn sm" onClick={() => approve(h)}>Approve</button>
            </div>
          ))}
          {tool.hosts.approved.map((h) => (
            <div key={h} className="tp-conn">
              <div className="tp-conn-main"><b>{h}</b></div>
              <span className="tp-status ok">approved</span>
              <button className="ghost sm" onClick={() => revoke(h)}>Revoke</button>
            </div>
          ))}
          {tool.hosts.pending.length > 0 && <p className="tp-hint" style={{ marginTop: 4 }}>A tool can only reach approved hosts. Approve one to allow this tool to call it.</p>}
        </section>

        <section className="tp-section">
          <div className="na-glabel">Actions <span className="na-count">{tool.actions.length}</span></div>
          {tool.actions.map((a) => {
            const ps = a.params ?? [];
            return (
              <div key={a.name} className="tp-action">
                <div className="tp-action-head">
                  <code className="tp-name">{a.name}</code>
                  <button className="btn sm" onClick={() => test(a.name, ps)}>Test</button>
                </div>
                {a.description && <p className="tp-action-desc">{a.description}</p>}
                {ps.length > 0 && (
                  <div className="tp-params">
                    {ps.map((p) => (
                      <label key={p} className="tp-param">
                        <span className="tp-param-name">{p}</span>
                        <input className="input" value={inputs[`${a.name}::${p}`] ?? ""} placeholder={`params.${p}`}
                          onChange={(e) => setInputs((s) => ({ ...s, [`${a.name}::${p}`]: e.target.value }))} />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {result && (
            <div className="tp-response">
              <span className="tp-response-label">Response</span>
              <pre className="tp-code">{result}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

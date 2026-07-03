import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, type GapItem } from "../api";
import { pendingSetup, type SetupItem } from "../setup";

const BellIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.5c-2 0-3.2 1.5-3.2 3.6v1.9c0 .6-.2 1.1-.6 1.6l-.8 1.2c-.3.35-.05.9.4.9h8.4c.45 0 .7-.55.4-.9l-.8-1.2c-.4-.5-.6-1-.6-1.6V6.1c0-2.1-1.2-3.6-3.2-3.6Z" />
    <path d="M6.3 12.3a1.8 1.8 0 0 0 3.4 0" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);

/** Renders the "Needs attention" bell trigger + right-side drawer: uncommitted vault changes, unconfigured tool connections, and backlog gap pages, with a total-count badge. */
export function NeedsAttention({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [setup, setSetup] = useState<SetupItem[]>([]);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const [s, tools, g] = await Promise.all([
      api.status().catch(() => ({ modified: [], created: [] })),
      api.tools().catch(() => []),
      api.gaps().catch(() => ({ gaps: [] })),
    ]);
    setStatus(s);
    setSetup(pendingSetup(tools));
    setGaps(g.gaps);
  }, []);
  useEffect(() => { refresh(); }, [refresh]); // initial load, so the badge is right without opening
  useEffect(() => { if (open) refresh(); }, [open, refresh]); // and fresh each time it's opened
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pendingFiles = status.modified.length + status.created.length;
  const total = pendingFiles + setup.length + gaps.length;

  const commit = async () => { await api.commit(); await refresh(); };
  const discard = async () => { await api.discard(); await refresh(); };
  const openLink = async (ref: string) => {
    try { const { url } = await api.secretLink(ref); window.open(url, "_blank", "noopener"); }
    catch (e) { setMsg(`Couldn't open a secret link for ${ref.split("__").pop()}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const test = async (tool: string, connection: string) => {
    try {
      const t = await api.tool(tool);
      const action = t.actions[0]?.name;
      if (!action) { setMsg("This tool has no action to test."); return; }
      const r = await api.testAction(tool, action, {});
      setMsg(r.status >= 200 && r.status < 300 ? `${connection} connected (HTTP ${r.status}).` : `${connection} failed (HTTP ${r.status}).`);
      await refresh();
    } catch (e) { setMsg(`${connection} failed: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <>
      <button className="iconbtn na-bell" onClick={() => setOpen((o) => !o)} title="Needs attention" aria-label="Needs attention">
        <BellIcon />
        {total > 0 && <span className="na-badge">{total}</span>}
      </button>
      {open && createPortal(<>
        <div className="na-overlay" onClick={() => setOpen(false)} />
        <aside className="na-drawer" role="dialog" aria-label="Needs attention">
          <header className="na-head">
            <div>
              <div className="na-eyebrow">Needs attention</div>
              <div className="na-sub">{total === 0 ? "You're all caught up" : `${total} item${total === 1 ? "" : "s"} to handle`}</div>
            </div>
            <button className="iconbtn na-x" onClick={() => setOpen(false)} aria-label="Close"><CloseIcon /></button>
          </header>
          <nav className="na-tabs">
            <button className="na-tab active">To do</button>
            <button className="na-tab" disabled title="Coming soon">Activity</button>
          </nav>
          <div className="na-body">
            {total === 0 && (
              <div className="na-caughtup">
                <span className="na-check"><CheckIcon /></span>
                <p>Nothing needs your attention</p>
                <span className="na-caughtup-sub">Uncommitted drafts, connections to set up, and backlog items show up here.</span>
              </div>
            )}
            {pendingFiles > 0 && (
              <section className="na-group">
                <div className="na-glabel">Pending changes <span className="na-count">{pendingFiles}</span></div>
                <div className="na-card">
                  <span className="na-card-title">{pendingFiles} file{pendingFiles === 1 ? "" : "s"} changed by the agent</span>
                  <div className="na-actions">
                    <button className="ghost sm" onClick={discard}>Discard</button>
                    <button className="btn sm" onClick={commit}>Commit</button>
                  </div>
                </div>
              </section>
            )}
            {setup.length > 0 && (
              <section className="na-group">
                <div className="na-glabel">Connections to set up <span className="na-count">{setup.length}</span></div>
                {setup.map((it) => (
                  <div key={`${it.tool}/${it.connection}`} className="na-card">
                    <span className="na-card-title"><b>{it.tool}</b> · {it.connection}</span>
                    <div className="na-actions">
                      {it.refs.map((r) => <button key={r} className="ghost sm" onClick={() => openLink(r)}>Set {r.split("__").pop()}</button>)}
                      <button className="btn sm" onClick={() => test(it.tool, it.connection)}>Test</button>
                    </div>
                  </div>
                ))}
              </section>
            )}
            {gaps.length > 0 && (
              <section className="na-group">
                <div className="na-glabel">Backlog · to build <span className="na-count">{gaps.length}</span></div>
                {gaps.map((g) => (
                  <div key={g.path} className="na-card">
                    <span className="na-card-title">{g.kind && <span className="na-kind">{g.kind}</span>}{g.title}</span>
                    {g.description && <span className="na-card-desc">{g.description}</span>}
                    <span className="na-path">{g.path}</span>
                  </div>
                ))}
              </section>
            )}
            {msg && <div className="na-msg">{msg}</div>}
          </div>
          <footer className="na-foot">
            <button className="na-manage" onClick={onOpenSettings}>Manage connections in Settings →</button>
          </footer>
        </aside>
      </>, document.body)}
    </>
  );
}

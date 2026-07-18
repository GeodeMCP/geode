import { Fragment, useEffect, useState } from "react";
import { api, type ToolView } from "../api";

const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** Closed padlock — a secret whose value is sealed. */
const LockClosed = () => (
  <svg viewBox="0 0 24 24" {...sw}><rect x="4.5" y="10.5" width="15" height="10.5" rx="3" /><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3" /><circle cx="12" cy="15" r="1.5" /><path d="M12 16.5v2.1" /></svg>
);
/** Open padlock — a required secret that has no value yet. */
const LockOpen = () => (
  <svg viewBox="0 0 24 24" {...sw}><rect x="4.5" y="10.5" width="15" height="10.5" rx="3" /><path d="M8 10.5V7.2a4 4 0 0 1 7.6-1.9" /><circle cx="12" cy="15" r="1.5" /><path d="M12 16.5v2.1" /></svg>
);
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" {...sw}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
const XIcon = () => (
  <svg viewBox="0 0 24 24" {...sw}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" {...sw}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

/** A minted one-time entry link. `replacing` marks a link for an already-sealed key, which has no landing signal to watch for. */
type PendingLink = { url: string; replacing: boolean };

/** Renders the Secrets view: a centered list of tool connections and their key rows. Values are never fetched — only refs and their sealed state. */
export function Secrets() {
  const [items, setItems] = useState<{ ref: string; requiredBy: string[] }[]>([]);
  const [tools, setTools] = useState<ToolView[]>([]);
  const [links, setLinks] = useState<Record<string, PendingLink>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const refresh = () => api.secrets().catch(() => []).then((list) => {
    setItems(list);
    const sealed = new Set(list.map((i) => i.ref));
    // A link for an empty key disappears the moment its value lands; a replacement link has no such signal and waits to be dismissed.
    setLinks((l) => Object.fromEntries(Object.entries(l).filter(([ref, v]) => v.replacing || !sealed.has(ref))));
  });
  useEffect(() => { refresh(); api.tools().then(setTools).catch(() => setTools([])); }, []);

  // The value lands in another tab, so this board only learns about it when the operator comes back.
  const waiting = Object.keys(links).length > 0;
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => { refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [waiting]);

  const stored = new Set(items.map((i) => i.ref));
  const needSecrets = tools.filter((t) => t.requires.length > 0);
  const orphans = items.filter((s) => !tools.some((t) => s.ref.startsWith(t.id + "__")));

  const mint = async (ref: string, replacing: boolean) => {
    const { url } = await api.secretLink(ref);
    setLinks((l) => ({ ...l, [ref]: { url, replacing } }));
  };
  const dismiss = (ref: string) => setLinks((l) => Object.fromEntries(Object.entries(l).filter(([r]) => r !== ref)));
  const remove = async (ref: string) => { await api.deleteSecret(ref); setConfirming(null); refresh(); };
  const copy = async (ref: string, url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(ref); setTimeout(() => setCopied(null), 1400); } catch { /* clipboard unavailable; the link is selectable */ }
  };

  // Live search over tool, connection, and key names. Counts always reflect real totals, not the filtered view.
  const q = query.trim().toLowerCase();
  const keyMatch = (t: ToolView, c: ToolView["connections"][number], k: string) =>
    !q || `${t.id} ${t.name} ${c.label} ${c.title ?? ""} ${c.description ?? ""} ${k}`.toLowerCase().includes(q);
  const toolNameMatch = (t: ToolView) => !!q && `${t.id} ${t.name}`.toLowerCase().includes(q);
  const visibleConns = (t: ToolView) => t.connections.filter((c) => toolNameMatch(t) || t.requires.some((k) => keyMatch(t, c, k)));
  const visibleTools = needSecrets.filter((t) => !q || toolNameMatch(t) || visibleConns(t).length > 0);
  const visibleOrphans = orphans.filter((s) => !q || s.ref.toLowerCase().includes(q));

  const nothingConfigured = needSecrets.length === 0 && orphans.length === 0;
  const noMatches = q !== "" && visibleTools.length === 0 && visibleOrphans.length === 0;

  const renderActions = (ref: string) => (
    confirming === ref ? (
      <>
        <button className="ghost sm danger" onClick={() => remove(ref)}>Remove</button>
        <button className="ghost sm" onClick={() => setConfirming(null)}>Cancel</button>
      </>
    ) : (
      <>
        <button className="ghost sm" onClick={() => mint(ref, true)}>Replace</button>
        <button className="ghost sm" onClick={() => setConfirming(ref)}>Remove</button>
      </>
    )
  );

  return (
    <div className="secrets">
      <div className="secrets-col">
        <div className="eyebrow">Secrets</div>
        <h1>Sealed values</h1>
        <p className="lede">
          Every value here is encrypted at rest and injected server-side at call time. It <b>never reaches this browser</b>,
          and never reaches an agent&apos;s context.
        </p>

        {nothingConfigured ? (
          <div className="empty-board">
            <b>Nothing needs a secret yet</b>
            When a tool&apos;s manifest declares <code>requires:</code>, its connections appear here waiting to be sealed.
          </div>
        ) : (
          <>
            <div className="search">
              <span className="s-mag"><SearchIcon /></span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search secrets, tools, or connections…"
                aria-label="Search secrets"
              />
              {query && <button className="s-clear" onClick={() => setQuery("")} aria-label="Clear search"><XIcon /></button>}
            </div>

            <div className="board">
              {visibleTools.map((t) => {
                const refs = t.connections.flatMap((c) => t.requires.map((k) => `${t.id}__${c.label}__${k}`));
                const sealed = refs.filter((r) => stored.has(r)).length;
                return (
                  <section className="cat" key={t.id}>
                    <div className="cat-head">
                      <span className="cat-name">{t.name}</span>
                      {refs.length > 0 && <span className="cat-count"><b>{sealed}</b> / {refs.length} sealed</span>}
                    </div>

                    {t.connections.length === 0 && <p className="orphan-note">No connections yet — add one to this tool&apos;s manifest.</p>}

                    {visibleConns(t).map((c) => (
                      <div className="conn" key={c.label}>
                        <div className="conn-label">
                          <b>{c.title || c.label}</b>
                          {c.title && <span className="cc">{c.label}</span>}
                        </div>
                        {c.description && <div className="conn-desc">{c.description}</div>}

                        {t.requires.filter((k) => keyMatch(t, c, k)).map((k) => {
                          const ref = `${t.id}__${c.label}__${k}`;
                          const isSealed = stored.has(ref);
                          const link = links[ref];
                          return (
                            <Fragment key={k}>
                              <div className={`srow ${isSealed ? "sealed" : "unset"}`} tabIndex={isSealed ? 0 : undefined}>
                                <span className="tile">{isSealed ? <LockClosed /> : <LockOpen />}</span>
                                <span className="kname">{k}</span>
                                {isSealed ? (
                                  <>
                                    <span className="status"><span className="pip" />Sealed</span>
                                    <span className="acts">{renderActions(ref)}</span>
                                  </>
                                ) : (
                                  <button className="set-btn" onClick={() => mint(ref, false)}>Set value<ArrowIcon /></button>
                                )}
                              </div>

                              {link && (
                                <div className="linkbox">
                                  <div className="lb-top">
                                    <span className="lb-lbl">One-time entry link</span>
                                    <span className="lb-note">Single use, expires in 10 minutes.</span>
                                    <button className="lb-x" onClick={() => dismiss(ref)} aria-label="Dismiss link"><XIcon /></button>
                                  </div>
                                  <div className="linkurl">{link.url}</div>
                                  <div className="lb-row">
                                    <button className="btn sm" onClick={() => window.open(link.url, "_blank", "noopener")}>Open</button>
                                    <button className="ghost sm" onClick={() => copy(ref, link.url)}>{copied === ref ? "Copied" : "Copy link"}</button>
                                  </div>
                                </div>
                              )}
                            </Fragment>
                          );
                        })}
                      </div>
                    ))}
                  </section>
                );
              })}

              {visibleOrphans.length > 0 && (
                <section className="cat orphans">
                  <div className="cat-head">
                    <span className="cat-name">Sealed values with no tool</span>
                    <span className="cat-count">{visibleOrphans.length}</span>
                  </div>
                  <p className="orphan-note">The tool was removed or renamed. These stay encrypted, but nothing can use them.</p>
                  {visibleOrphans.map((s) => (
                    <div className="orphan" key={s.ref}>
                      <span className="oref">{s.ref}</span>
                      {confirming === s.ref ? (
                        <span className="oacts">
                          <button className="ghost sm danger" onClick={() => remove(s.ref)}>Remove</button>
                          <button className="ghost sm" onClick={() => setConfirming(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button className="ghost sm" onClick={() => setConfirming(s.ref)}>Remove</button>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {noMatches && (
                <div className="empty-board">
                  <b>No secrets match &ldquo;{query}&rdquo;</b>
                  Try a tool name, a connection, or a key like <code>ADMIN_ID</code>.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

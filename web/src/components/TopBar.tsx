import { useState, type ReactNode } from "react";
import { GemMark } from "./Logo";
import { NeedsAttention } from "./NeedsAttention";

/** Ordered list of all navigable dashboard views. */
export const VIEWS = ["Vault", "Connect", "Secrets"] as const;
/** Union type of valid view names derived from VIEWS. */
export type View = typeof VIEWS[number];
const ALWAYS = new Set<View>(["Vault", "Connect"]);

const ConnectIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 9.5 9.5 6.5M7 4.5l.8-.8a2.4 2.4 0 0 1 3.4 3.4l-.8.8M9 11.5l-.8.8a2.4 2.4 0 0 1-3.4-3.4l.8-.8" />
  </svg>
);
const VaultIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.2" y="3" width="11.6" height="10" rx="1.6" /><circle cx="8" cy="8" r="2.2" /><path d="M8 8h2.7" />
  </svg>
);
const SecretsIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="10" height="7" rx="2" /><path d="M5.3 7V5.1a2.7 2.7 0 0 1 5.4 0V7" /><circle cx="8" cy="10" r="1" /><path d="M8 11v1.3" />
  </svg>
);

// Icon shown beside each nav tab.
const NAV_ICON: Record<View, ReactNode> = {
  Vault: <VaultIcon />,
  Connect: <ConnectIcon />,
  Secrets: <SecretsIcon />,
};

/** Renders the application top bar with branding, navigation tabs, and an account dropdown menu. */
export function TopBar({ view, onNav, hasTools, onLogout }: {
  view: View; onNav: (v: View) => void; hasTools: boolean; onLogout: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const items = VIEWS.filter((v) => (hasTools || ALWAYS.has(v)) && v !== "Connect");
  return (
    <div className="topbar">
      <div className="brand">
        <GemMark size={22} />
        <span className="name">Geode</span>
      </div>
      <div className="tb-end">
        <nav>{items.map((v) => <a key={v} className={v === view ? "active" : ""} onClick={() => onNav(v)} style={{ cursor: "pointer" }}>{NAV_ICON[v]}{v}</a>)}</nav>
        <span className="tb-divider" aria-hidden="true" />
        <div className="tb-right">
          <button className={`pill${view === "Connect" ? " active" : ""}`} onClick={() => onNav("Connect")} title="Connect a client"><ConnectIcon /> Connect</button>
          <NeedsAttention onOpenSettings={() => onNav("Secrets")} />
          <span className="acct">
            <span className="avatar" onClick={() => setMenu((m) => !m)} title="Account" />
            {menu && <>
              <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
              <div className="menu"><button onClick={() => { setMenu(false); onLogout(); }}>Log out</button></div>
            </>}
          </span>
        </div>
      </div>
    </div>
  );
}

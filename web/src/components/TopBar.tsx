import { useState, type ReactNode } from "react";
import { GemMark } from "./Logo";
import { McpStatus } from "./McpStatus";

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
    <circle cx="5.6" cy="5.6" r="2.7" /><path d="M7.5 7.5 13 13M10.8 11.2l1.4-1.4M9 9.4l1.4-1.4" />
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
      <nav>{items.map((v) => <a key={v} className={v === view ? "active" : ""} onClick={() => onNav(v)} style={{ cursor: "pointer" }}>{NAV_ICON[v]}{v}</a>)}</nav>
      <div className="tb-right">
        <McpStatus />
        <button className={`pill${view === "Connect" ? " active" : ""}`} onClick={() => onNav("Connect")} title="Connect a client"><ConnectIcon /> Connect</button>
        <span className="acct">
          <span className="avatar" onClick={() => setMenu((m) => !m)} title="Account" />
          {menu && <>
            <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9 }} />
            <div className="menu"><button onClick={() => { setMenu(false); onLogout(); }}>Log out</button></div>
          </>}
        </span>
      </div>
    </div>
  );
}

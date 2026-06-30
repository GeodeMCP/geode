import { useState } from "react";
import { GemMark } from "./Logo";

/** Ordered list of all navigable dashboard views. */
export const VIEWS = ["Vault", "Connect", "Secrets", "Artifacts"] as const;
/** Union type of valid view names derived from VIEWS. */
export type View = typeof VIEWS[number];
const ALWAYS = new Set<View>(["Vault", "Connect"]);

/** Renders the application top bar with branding, navigation tabs, and an account dropdown menu. */
export function TopBar({ view, onNav, hasTools, onLogout }: {
  view: View; onNav: (v: View) => void; hasTools: boolean; onLogout: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const items = VIEWS.filter((v) => hasTools || ALWAYS.has(v));
  return (
    <div className="topbar">
      <div className="brand">
        <GemMark size={22} />
        <span className="name">Geode</span>
        <span className="ws">personal-vault</span>
      </div>
      <nav>{items.map((v) => <a key={v} className={v === view ? "active" : ""} onClick={() => onNav(v)} style={{ cursor: "pointer" }}>{v}</a>)}</nav>
      <div className="tb-right">
        <span className="chip live"><span className="pulse" />live</span>
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

import { useState } from "react";
import { api } from "../api";
import type { SetupItem } from "../setup";

/** A banner listing tool connections that still need secrets, with a capture-link opener per secret and a test button. */
export function SetupStrip({ items, onDone }: { items: SetupItem[]; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  if (!items.length) return null;
  const openLink = async (ref: string) => {
    try {
      const { url } = await api.secretLink(ref);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setMsg(`✗ ${ref.split("__").pop()}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const test = async (tool: string, connection: string) => {
    try {
      const t = await api.tool(tool);
      const action = t.actions[0]?.name;
      if (!action) { setMsg("no action to test"); return; }
      const r = await api.testAction(tool, action, {});
      setMsg(r.status >= 200 && r.status < 300 ? `✓ ${connection} works (HTTP ${r.status})` : `✗ ${connection}: HTTP ${r.status}`);
      onDone();
    } catch (e) { setMsg(`✗ ${connection}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <div className="dirty-banner" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <span>Set up connection secrets:</span>
      {items.map((it) => (
        <div key={`${it.tool}/${it.connection}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <b>{it.tool} / {it.connection}</b>
          {it.refs.map((r) => <button key={r} className="ghost sm" onClick={() => openLink(r)}>Set {r.split("__").pop()}</button>)}
          <button className="btn sm" onClick={() => test(it.tool, it.connection)}>Test</button>
        </div>
      ))}
      {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}

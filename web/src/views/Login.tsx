import { useState } from "react";
import { api } from "../api";

export function Login({ onIn }: { onIn: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.login(pw); onIn(); } catch { setErr("Onjuist wachtwoord"); }
  };
  return (
    <div className="auth">
      <div className="glow" />
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="12,2 22,9 12,22" fill="#3FCFA1" /><polygon points="12,2 2,9 12,22" fill="#86ECCB" /><polygon points="2,9 12,22 22,9" fill="#4C7DF4" opacity=".85" /></svg>
          <span className="name">Geode</span>
        </div>
        <span className="eyebrow" style={{ padding: 0 }}>Dashboard</span>
        <h2>Inloggen</h2>
        <input className="input" type="password" placeholder="Dashboard-wachtwoord" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p style={{ color: "#eaa", fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>Inloggen</button>
      </form>
    </div>
  );
}

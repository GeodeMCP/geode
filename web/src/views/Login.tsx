import { useState } from "react";
import { api } from "../api";
export function Login({ onIn }: { onIn: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); try { await api.login(pw); onIn(); } catch { setErr("Onjuist wachtwoord"); } };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <form className="card" style={{ width: 360 }} onSubmit={submit}>
        <span className="eyebrow">Geode</span>
        <h2>Inloggen</h2>
        <input className="input" type="password" placeholder="Dashboard-wachtwoord" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <p style={{ color: "#eaa", fontSize: 13 }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 12 }}>Inloggen</button>
      </form>
    </div>
  );
}

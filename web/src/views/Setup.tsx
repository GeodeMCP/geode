import { useState } from "react";
import { api } from "../api";
import { GemMark } from "../components/Logo";

export function Setup({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) { setErr("Passwords don't match"); return; }
    if (pw.length < 10) { setErr("Use at least 10 characters"); return; }
    try { await api.setup(email, pw); onIn(); } catch (e) { setErr(e instanceof Error ? e.message : "Setup failed"); }
  };
  return (
    <div className="auth">
      <div className="glow" />
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><GemMark size={22} /><span className="name">Geode</span></div>
        <span className="eyebrow" style={{ padding: 0 }}>First run</span>
        <h2>Create your vault</h2>
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 10 }} />
        <input className="input" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ marginTop: 10 }} />
        {err && <p style={{ color: "#eaa", fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>Create vault</button>
      </form>
    </div>
  );
}

import { useState } from "react";
import { api } from "../api";
import { GemMark } from "../components/Logo";

/** Renders the Login view with an email and password form that authenticates the user and calls onIn on success. */
export function Login({ onIn }: { onIn: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.login(email, pw); onIn(); } catch { setErr("Wrong credentials"); }
  };
  return (
    <div className="auth">
      <div className="glow" />
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand"><GemMark size={22} /><span className="name">Geode</span></div>
        <span className="eyebrow" style={{ padding: 0 }}>Dashboard</span>
        <h2>Sign in</h2>
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus style={{ marginBottom: 10 }} />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p style={{ color: "#eaa", fontSize: 13, margin: "10px 0 0" }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 14, justifyContent: "center" }}>Sign in</button>
      </form>
    </div>
  );
}

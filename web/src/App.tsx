import { useCallback, useEffect, useState } from "react";
import { api, type AuthInfo } from "./api";
import { Login } from "./views/Login";
import { Setup } from "./views/Setup";
import { TopBar, type View } from "./components/TopBar";
import { VaultHome } from "./views/VaultHome";
import { Capabilities } from "./views/Capabilities";
import { Connect } from "./views/Connect";
import { Integrations } from "./views/Integrations";
import { Secrets } from "./views/Secrets";
import { Artifacts } from "./views/Artifacts";

export function App() {
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [view, setView] = useState<View>("Vault");
  const [hasTools, setHasTools] = useState(false);
  const refresh = useCallback(() => api.authInfo().then(setAuth).catch(() => setAuth({ mode: "login", authed: false })), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (auth?.authed) api.integrations().then((l) => setHasTools(l.length > 0)).catch(() => {}); }, [auth?.authed]);
  const logout = async () => { await api.logout().catch(() => {}); setHasTools(false); setView("Vault"); refresh(); };
  if (!auth) return null;
  if (!auth.authed) return auth.mode === "setup"
    ? <Setup onIn={refresh} />
    : <Login onIn={refresh} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar view={view} onNav={setView} hasTools={hasTools} onLogout={logout} />
      {view === "Vault" && <VaultHome />}
      {view === "Capabilities" && <Capabilities />}
      {view === "Connect" && <Connect />}
      {view === "Integrations" && <Integrations />}
      {view === "Secrets" && <Secrets />}
      {view === "Artifacts" && <Artifacts />}
    </div>
  );
}

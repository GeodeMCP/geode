import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./views/Login";
import { TopBar, type View } from "./components/TopBar";
import { VaultHome } from "./views/VaultHome";
import { Capabilities } from "./views/Capabilities";
import { Integrations } from "./views/Integrations";
import { Secrets } from "./views/Secrets";
import { Artifacts } from "./views/Artifacts";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("Vault");
  const [hasTools, setHasTools] = useState(false);
  useEffect(() => { api.tree().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  useEffect(() => { if (authed) api.integrations().then((l) => setHasTools(l.length > 0)).catch(() => {}); }, [authed]);
  if (authed === null) return null;
  if (!authed) return <Login onIn={() => setAuthed(true)} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar view={view} onNav={setView} hasTools={hasTools} />
      {view === "Vault" && <VaultHome />}
      {view === "Capabilities" && <Capabilities />}
      {view === "Integrations" && <Integrations />}
      {view === "Secrets" && <Secrets />}
      {view === "Artifacts" && <Artifacts />}
    </div>
  );
}

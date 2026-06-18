import { useEffect, useState } from "react";
import { api } from "./api";
import { Login } from "./views/Login";
import { VaultHome } from "./views/VaultHome";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { api.tree().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return null;
  return authed ? <VaultHome /> : <Login onIn={() => setAuthed(true)} />;
}

import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent } from "../api";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { Viewer } from "../components/Viewer";

export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [diff, setDiff] = useState("");
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => { setTree(await api.tree()); setStatus(await api.status()); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!selected) { setContent(""); setDiff(""); return; }
    api.file(selected).then((f) => setContent(f.content)).catch(() => setContent(""));
    if (status.modified.includes(selected) || status.created.includes(selected)) api.diff(selected).then((d) => setDiff(d.diff));
    else setDiff("");
  }, [selected, status]);

  const dirty = status.modified.length + status.created.length > 0;
  const selectedDirty = !!selected && (status.modified.includes(selected) || status.created.includes(selected));

  const send = async (instruction: string, onEvent: (e: SseEvent) => void) => {
    setRunning(true);
    try {
      await api.run("/api/query", { instruction }, (e) => { onEvent(e); if (e.event === "result") { const f = e.data.filesTouched?.[0]; if (f) setSelected(f); } });
      await refresh();
    } finally { setRunning(false); }
  };
  const commit = async () => { await api.commit(); await refresh(); setDiff(""); };
  const discard = async () => { await api.discard(); await refresh(); setDiff(""); setSelected(null); };
  const save = async (text: string) => { if (!selected) return; await api.writeFile(selected, text); await refresh(); };
  const newNote = async () => {
    const name = window.prompt("Naam van de notitie")?.trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "notitie";
    const path = `notes/${slug}.md`;
    await api.writeFile(path, `---\ntype: note\ntitle: ${name}\n---\n\n`);
    await refresh(); setSelected(path);
  };

  return (
    <div className="main">
      <Chat onSend={send} running={running} dirty={dirty} onCommit={commit} onDiscard={discard} />
      <FileTree tree={tree} status={status} selected={selected} onSelect={setSelected} onNew={newNote} />
      <Viewer path={selected} content={content} diff={diff} dirty={selectedDirty} onCommit={commit} onDiscard={discard} onSave={save} />
    </div>
  );
}

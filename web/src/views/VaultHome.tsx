import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent } from "../api";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { Viewer } from "../components/Viewer";

/** Renders the main vault view with a chat panel, file tree, and file viewer/editor for browsing and editing vault context files. */
export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [diff, setDiff] = useState("");
  const [running, setRunning] = useState(false);
  const [compose, setCompose] = useState<{ path: string; draft: string } | null>(null);

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
  const discard = async () => { await api.discard(); await refresh(); setDiff(""); setSelected(null); setCompose(null); };
  const save = async (text: string) => { if (!selected) return; await api.writeFile(selected, text); setCompose(null); await refresh(); };
  const create = (input: string) => {
    let p = input.trim().replace(/^\/+/, "");
    if (!p) return;
    if (!/\.[a-z0-9]+$/i.test(p)) p += ".md";
    const title = p.replace(/\.[^.]+$/, "").split("/").pop() || "note";
    setCompose({ path: p, draft: `---\ntype: note\ntitle: ${title}\n---\n\n` });
    setSelected(p);
  };
  const select = (p: string) => { setCompose(null); setSelected(p); };
  const del = async (p: string) => {
    await api.deletePath(p);
    if (selected === p || (selected && selected.startsWith(p + "/"))) { setSelected(null); setCompose(null); }
    await refresh();
  };

  return (
    <div className="main">
      <Chat onSend={send} running={running} dirty={dirty} onCommit={commit} onDiscard={discard} />
      <FileTree tree={tree} status={status} selected={selected} onSelect={select} onCreate={create} onDelete={del} />
      <Viewer path={selected} content={content} diff={diff} dirty={selectedDirty} compose={compose} onCommit={commit} onDiscard={discard} onSave={save} />
    </div>
  );
}

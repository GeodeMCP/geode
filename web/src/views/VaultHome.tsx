import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent } from "../api";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { Viewer } from "../components/Viewer";

export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    setTree(await api.tree()); setStatus(await api.status());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (selected) api.diff(selected).then((d) => setDiff(d.diff)); }, [selected, status]);

  const dirty = status.modified.length + status.created.length > 0;

  const send = async (instruction: string, onEvent: (e: SseEvent) => void) => {
    setRunning(true);
    try {
      await api.run("/api/query", { instruction }, (e) => {
        onEvent(e);
        if (e.event === "result") { const f = e.data.filesTouched?.[0]; if (f) setSelected(f); }
      });
      await refresh();
    } finally { setRunning(false); }
  };
  const commit = async () => { await api.commit(); await refresh(); setDiff(""); };
  const discard = async () => { await api.discard(); await refresh(); setDiff(""); };

  return (
    <div className="main">
      <Chat onSend={send} running={running} dirty={dirty} />
      <FileTree tree={tree} status={status} selected={selected} onSelect={setSelected} />
      <Viewer path={selected} diff={diff} dirty={dirty} onCommit={commit} onDiscard={discard} />
    </div>
  );
}

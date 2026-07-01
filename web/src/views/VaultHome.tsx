import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent, type ToolView } from "../api";
import { isArtifactPath, buildArtifactTree } from "../artifacts";
import { newFileDraft } from "../fileType";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { Viewer } from "../components/Viewer";

/** Renders the main vault view with a chat panel, file tree, and file viewer/editor for browsing and editing vault context files. */
export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [needsInstall, setNeedsInstall] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [diff, setDiff] = useState("");
  const [running, setRunning] = useState(false);
  const [compose, setCompose] = useState<{ path: string; draft: string } | null>(null);

  const refresh = useCallback(async () => {
    const [t, arts, tools] = await Promise.all([api.tree(), api.artifacts().catch(() => [] as { path: string }[]), api.tools().catch(() => [] as ToolView[])]);
    setTree(arts.length
      ? [...t, { name: "artifacts", path: "artifacts", type: "dir" as const, children: buildArtifactTree(arts.map((a) => a.path)) }]
      : t);
    setStatus(await api.status());
    setNeedsInstall(new Set(tools.filter((x) => x.type === "cli" && !x.installed).map((x) => x.id)));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!selected) { setContent(""); setDiff(""); return; }
    if (isArtifactPath(selected)) { setContent(""); setDiff(""); return; }
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
    const nf = newFileDraft(input);
    if (!nf) return;
    setCompose({ path: nf.path, draft: nf.draft });
    setSelected(nf.path);
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
      <FileTree tree={tree} status={status} selected={selected} onSelect={select} onCreate={create} onDelete={del} needsInstall={needsInstall} />
      <Viewer path={selected} content={content} diff={diff} dirty={selectedDirty} compose={compose} onCommit={commit} onDiscard={discard} onSave={save} onOpenFile={select} />
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api, type TreeNode, type SseEvent, type ToolView } from "../api";
import { isArtifactPath, buildArtifactTree } from "../artifacts";
import { newFileDraft } from "../fileType";
import { pendingSetup, type SetupItem } from "../setup";
import { Chat } from "../components/Chat";
import { FileTree } from "../components/FileTree";
import { SetupStrip } from "../components/SetupStrip";
import { Viewer } from "../components/Viewer";

/** Renders the main vault view with a chat panel, file tree, and file viewer/editor for browsing and editing vault context files. */
export function VaultHome() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<{ modified: string[]; created: string[] }>({ modified: [], created: [] });
  const [needsInstall, setNeedsInstall] = useState<Set<string>>(new Set());
  const [autoRun, setAutoRun] = useState<{ id: number; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [diff, setDiff] = useState("");
  const [running, setRunning] = useState(false);
  const [compose, setCompose] = useState<{ path: string; draft: string } | null>(null);
  const [setup, setSetup] = useState<SetupItem[]>([]);

  const refresh = useCallback(async () => {
    const [t, arts, tools] = await Promise.all([api.tree(), api.artifacts().catch(() => [] as { path: string }[]), api.tools().catch(() => [] as ToolView[])]);
    setTree(arts.length
      ? [...t, { name: "artifacts", path: "artifacts", type: "dir" as const, children: buildArtifactTree(arts.map((a) => a.path)) }]
      : t);
    setStatus(await api.status());
    setNeedsInstall(new Set(tools.filter((x) => x.type === "cli" && !x.installed).map((x) => x.id)));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const refreshTools = useCallback(async () => { setSetup(pendingSetup(await api.tools().catch(() => []))); }, []);
  useEffect(() => { refreshTools(); }, [refreshTools]);
  useEffect(() => {
    if (!selected) { setContent(""); setDiff(""); return; }
    if (isArtifactPath(selected)) { setContent(""); setDiff(""); return; }
    api.file(selected).then((f) => setContent(f.content)).catch(() => setContent(""));
    if (status.modified.includes(selected) || status.created.includes(selected)) api.diff(selected).then((d) => setDiff(d.diff));
    else setDiff("");
  }, [selected, status]);

  const dirty = status.modified.length + status.created.length > 0;
  const selectedDirty = !!selected && (status.modified.includes(selected) || status.created.includes(selected));

  const send = async (instruction: string, onEvent: (e: SseEvent) => void, attachments?: string[]) => {
    setRunning(true);
    try {
      await api.run("/api/query", { instruction, attachments }, (e) => { onEvent(e); if (e.event === "result") { const f = e.data.filesTouched?.[0]; if (f) setSelected(f); } });
      await refresh();
      await refreshTools();
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
  const del = (p: string) => {
    // Route deletes through the agent so it removes the path AND keeps index.md/log.md/references consistent.
    setAutoRun({ id: Date.now(), text: `/delete ${p}` });
    if (selected === p || (selected && selected.startsWith(p + "/"))) { setSelected(null); setCompose(null); }
  };

  return (
    <div className="col" style={{ flex: 1 }}>
      <SetupStrip items={setup} onDone={refreshTools} />
      <div className="main">
        <Chat onSend={send} running={running} dirty={dirty} onCommit={commit} onDiscard={discard} autoRun={autoRun} />
        <FileTree tree={tree} status={status} selected={selected} onSelect={select} onCreate={create} onDelete={del} needsInstall={needsInstall} />
        <Viewer path={selected} content={content} diff={diff} dirty={selectedDirty} compose={compose} onCommit={commit} onDiscard={discard} onSave={save} onOpenFile={select} />
      </div>
    </div>
  );
}

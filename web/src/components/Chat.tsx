import { useEffect, useRef, useState } from "react";
import type { SseEvent } from "../api";
import { renderMarkdown } from "../markdown";

type Msg = { who: "me" | "ag"; text: string };
const STORE = "geode.chat.v1";
const loadMsgs = (): Msg[] => { try { return JSON.parse(localStorage.getItem(STORE) || "[]") as Msg[]; } catch { return []; } };

export function Chat({ onSend, running, dirty, onCommit, onDiscard }: {
  onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>;
  running: boolean; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs);
  const [thinking, setThinking] = useState<string | null>(null);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, thinking]);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(msgs)); } catch { /* quota/private mode */ } }, [msgs]);

  const submit = async () => {
    const instruction = text.trim();
    if (!instruction || running || dirty) return;
    setText("");
    setMsgs((m) => [...m, { who: "me", text: instruction }]);
    setThinking("Thinking…");
    await onSend(instruction, (e) => {
      if (e.event === "progress") setThinking(e.data.message || "Thinking…");
      else if (e.event === "result") setMsgs((m) => [...m, { who: "ag", text: e.data.text }]);
      else if (e.event === "error") setMsgs((m) => [...m, { who: "ag", text: "Error: " + e.data.message }]);
    });
    setThinking(null);
  };

  return (
    <div className="col chat">
      <div className="eyebrow" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Vault agent</span>
        {msgs.length > 0 && <button className="ghost sm" style={{ textTransform: "none", letterSpacing: 0 }} onClick={() => setMsgs([])}>Clear</button>}
      </div>
      {dirty && (
        <div className="dirty-banner">
          <span style={{ flex: 1 }}>You have uncommitted changes.</span>
          <button className="ghost sm" onClick={onDiscard}>Discard</button>
          <button className="btn sm" onClick={onCommit}>Commit</button>
        </div>
      )}
      <div className="msgs">
        {msgs.length === 0 && thinking === null && !dirty && <div style={{ color: "var(--faint)", fontSize: 13 }}>Ask your vault something, or add knowledge.</div>}
        {msgs.map((m, i) => m.who === "ag"
          ? <div key={i} className="bubble ag md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
          : <div key={i} className="bubble me">{m.text}</div>)}
        {thinking !== null && (
          <div className="thinking">
            <span className="tdots"><i /><i /><i /></span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{thinking}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="ctrl">
        <input className="input" value={text} disabled={running || dirty}
          placeholder={dirty ? "Commit or discard your changes first…" : running ? "Working…" : "Talk to your vault…"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </div>
  );
}

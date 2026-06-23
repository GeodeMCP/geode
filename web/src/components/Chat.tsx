import { useEffect, useRef, useState } from "react";
import type { SseEvent } from "../api";
import { renderMarkdown } from "../markdown";
import { ColHead } from "./ColHead";

type Msg = { who: "me" | "ag" | "step"; text: string; animate?: boolean };
const STORE = "geode.chat.v1";
const loadMsgs = (): Msg[] => { try { return (JSON.parse(localStorage.getItem(STORE) || "[]") as Msg[]).map((m) => ({ who: m.who, text: m.text })); } catch { return []; } };

const StepIcon = () => (
  <svg className="step-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
);

// Reveals the agent's text as if typed; pre-typed (persisted) messages render instantly.
function AgentBubble({ text, animate }: { text: string; animate?: boolean }) {
  const [shown, setShown] = useState(animate ? "" : text);
  useEffect(() => {
    if (!animate) { setShown(text); return; }
    let i = 0; const step = Math.max(2, Math.ceil(text.length / 90));
    const id = window.setInterval(() => { i += step; setShown(text.slice(0, i)); if (i >= text.length) window.clearInterval(id); }, 18);
    return () => window.clearInterval(id);
  }, []); // animate once on mount
  return <div className="bubble ag md" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown || "…") }} />;
}

export function Chat({ onSend, running, dirty, onCommit, onDiscard }: {
  onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>;
  running: boolean; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, running]);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(msgs.map((m) => ({ who: m.who, text: m.text })))); } catch { /* quota/private mode */ } }, [msgs]);

  const submit = async () => {
    const instruction = text.trim();
    if (!instruction || running || dirty) return;
    setText("");
    setMsgs((m) => [...m, { who: "me", text: instruction }]);
    let lastStep = "";
    let lastAgent = "";
    await onSend(instruction, (e) => {
      if (e.event === "progress") {
        const t = (e.data.message || "").trim();
        if (!t) return;
        if (t.startsWith("→")) {                                   // a tool action — engine marks tool use with "→ <Tool>"
          const name = t.replace(/^→\s*/, "");
          if (name && name !== lastStep) { lastStep = name; setMsgs((m) => [...m, { who: "step", text: name }]); }
        } else {                                                    // the agent's prose — a real (markdown) message
          lastAgent = t; setMsgs((m) => [...m, { who: "ag", text: t, animate: true }]);
        }
      } else if (e.event === "result") {
        const t = (e.data.text || "").trim();
        if (t && t !== lastAgent) setMsgs((m) => [...m, { who: "ag", text: t, animate: true }]);   // dedupe: skip if already shown as the last prose
      } else if (e.event === "error") {
        setMsgs((m) => [...m, { who: "ag", text: "Error: " + e.data.message }]);
      }
    });
  };

  return (
    <div className="col chat">
      <ColHead title="Vault agent">
        {msgs.length > 0 && <button className="ghost sm" style={{ textTransform: "none", letterSpacing: 0 }} onClick={() => setMsgs([])}>Clear</button>}
      </ColHead>
      {dirty && (
        <div className="dirty-banner">
          <span style={{ flex: 1 }}>You have uncommitted changes.</span>
          <button className="ghost sm" onClick={onDiscard}>Discard</button>
          <button className="btn sm" onClick={onCommit}>Commit</button>
        </div>
      )}
      <div className="msgs">
        {msgs.length === 0 && !running && !dirty && <div style={{ color: "var(--faint)", fontSize: 13 }}>Ask your vault something, or add knowledge.</div>}
        {msgs.map((m, i) => {
          if (m.who === "me") return <div key={i} className="bubble me">{m.text}</div>;
          if (m.who === "step") return <div key={i} className="step"><StepIcon />{m.text}</div>;
          return <AgentBubble key={i} text={m.text} animate={m.animate} />;
        })}
        {running && <div className="thinking"><span className="tdots"><i /><i /><i /></span></div>}
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

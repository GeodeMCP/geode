import { useEffect, useRef, useState } from "react";
import type { SseEvent } from "../api";
import { renderMarkdown } from "../markdown";
import { ColHead } from "./ColHead";

type Msg = { who: "me" | "ag" | "step"; text?: string; name?: string; summary?: string; detail?: string; ts: number; animate?: boolean };
const STORE = "geode.chat.v1";
const loadMsgs = (): Msg[] => {
  try { return (JSON.parse(localStorage.getItem(STORE) || "[]") as Msg[]).map((m) => ({ ...m, ts: m.ts ?? Date.now(), animate: false })); } catch { return []; }
};

const fmtTime = (ts: number) => {
  const d = new Date(ts), t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${t}`;
};
const fullTime = (ts: number) => new Date(ts).toLocaleString();

// Reveals the agent's text as if typed; pre-typed (persisted) messages render instantly.
function AgentBubble({ text, animate }: { text: string; animate?: boolean }) {
  const [shown, setShown] = useState(animate ? "" : text);
  useEffect(() => {
    if (!animate) { setShown(text); return; }
    let i = 0; const step = Math.max(2, Math.ceil(text.length / 90));
    const id = window.setInterval(() => { i += step; setShown(text.slice(0, i)); if (i >= text.length) window.clearInterval(id); }, 18);
    return () => window.clearInterval(id);
  }, []);
  return <div className="bubble ag md" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown || "…") }} />;
}

// A tool action: collapsed shows type + short summary; the chevron expands to the full detail.
function StepBubble({ name, summary, detail, ts }: { name: string; summary?: string; detail?: string; ts: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!detail;
  return (
    <div className={`bubble step ${open ? "open" : ""}`}>
      <div className="step-row" onClick={() => hasDetail && setOpen((o) => !o)} style={{ cursor: hasDetail ? "pointer" : "default" }}>
        {hasDetail
          ? <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          : <span className="chev-spacer" />}
        <span className="step-name">{name}</span>
        {summary && <span className="arg">{summary}</span>}
        <span className="msg-time" title={fullTime(ts)}>{fmtTime(ts)}</span>
      </div>
      {open && detail && <pre className="step-detail">{detail}</pre>}
    </div>
  );
}

export function Chat({ onSend, running, dirty, onCommit, onDiscard }: {
  onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>;
  running: boolean; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, running]);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(msgs.map(({ animate, ...m }) => m))); } catch { /* quota/private mode */ } }, [msgs]);

  const submit = async () => {
    const instruction = text.trim();
    if (!instruction || running || dirty) return;
    setText("");
    setMsgs((m) => [...m, { who: "me", text: instruction, ts: Date.now() }]);
    let lastStep = "";
    let lastAgent = "";
    await onSend(instruction, (e) => {
      if (e.event === "progress") {
        const t = (e.data.message || "").trim();
        if (!t) return;
        if (t.startsWith("→")) {
          const label = t.replace(/^→\s*/, "");                                  // "Bash · git status"
          const [name, ...rest] = label.split(" · ");
          if (label !== lastStep) { lastStep = label; setMsgs((m) => [...m, { who: "step", name, summary: rest.join(" · "), detail: e.data.detail || undefined, ts: Date.now() }]); }
        } else {
          lastAgent = t; setMsgs((m) => [...m, { who: "ag", text: t, animate: true, ts: Date.now() }]);
        }
      } else if (e.event === "result") {
        const t = (e.data.text || "").trim();
        if (t && t !== lastAgent) setMsgs((m) => [...m, { who: "ag", text: t, animate: true, ts: Date.now() }]);
      } else if (e.event === "error") {
        setMsgs((m) => [...m, { who: "ag", text: "Error: " + e.data.message, ts: Date.now() }]);
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
          if (m.who === "step") return <StepBubble key={i} name={m.name || ""} summary={m.summary} detail={m.detail} ts={m.ts} />;
          return (
            <div key={i} className={`msg-wrap ${m.who}`}>
              {m.who === "ag" ? <AgentBubble text={m.text || ""} animate={m.animate} /> : <div className="bubble me">{m.text}</div>}
              <span className="msg-time" title={fullTime(m.ts)}>{fmtTime(m.ts)}</span>
            </div>
          );
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

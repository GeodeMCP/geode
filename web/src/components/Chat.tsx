import { useState } from "react";
import type { SseEvent } from "../api";

type Msg = { who: "me" | "ag" | "card" | "progress"; text: string };

export function Chat({ onSend, running, dirty, onCommit, onDiscard }: {
  onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>;
  running: boolean; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const submit = async () => {
    const instruction = text.trim();
    if (!instruction || running || dirty) return;
    setText(""); setMsgs((m) => [...m, { who: "me", text: instruction }]);
    await onSend(instruction, (e) => {
      if (e.event === "progress") setMsgs((m) => [...m, { who: "progress", text: e.data.message }]);
      else if (e.event === "result") setMsgs((m) => [...m, { who: "card", text: e.data.text }]);
      else if (e.event === "error") setMsgs((m) => [...m, { who: "ag", text: "Fout: " + e.data.message }]);
    });
  };
  return (
    <div className="col chat">
      <div className="eyebrow">Vault agent</div>
      {dirty && (
        <div className="dirty-banner">
          <span style={{ flex: 1 }}>Je hebt openstaande wijzigingen.</span>
          <button className="ghost sm" onClick={onDiscard}>Verwerp</button>
          <button className="btn sm" onClick={onCommit}>Commit</button>
        </div>
      )}
      <div className="msgs">
        {msgs.length === 0 && !dirty && <div style={{ color: "var(--faint)", fontSize: 13 }}>Vraag je vault iets, of voeg kennis toe.</div>}
        {msgs.map((m, i) => m.who === "card"
          ? <div key={i} className="card"><span>{m.text}</span></div>
          : <div key={i} className={`bubble ${m.who === "me" ? "me" : "ag"}`} style={m.who === "progress" ? { opacity: .6, fontSize: 13 } : undefined}>{m.text}</div>)}
      </div>
      <div className="ctrl">
        <input className="input" value={text} disabled={running || dirty}
          placeholder={dirty ? "Commit of verwerp eerst je wijzigingen…" : running ? "Bezig…" : "Praat met je vault…"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </div>
  );
}

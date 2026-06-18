import { useState } from "react";
import type { SseEvent } from "../api";
type Msg = { who: "me" | "ag" | "card" | "progress"; text: string };
export function Chat({ onSend, running }: { onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>; running: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const submit = async () => {
    const instruction = text.trim(); if (!instruction || running) return;
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
      <div className="msgs">
        {msgs.map((m, i) => m.who === "card"
          ? <div key={i} className="card"><span>{m.text}</span></div>
          : <div key={i} className={`bubble ${m.who === "me" ? "me" : "ag"}`} style={m.who === "progress" ? { opacity: .6, fontSize: 13 } : undefined}>{m.text}</div>)}
      </div>
      <div className="ctrl">
        <input className="input" placeholder="Praat met je vault…" value={text} disabled={running}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </div>
  );
}

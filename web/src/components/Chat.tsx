import { useEffect, useRef, useState } from "react";
import { api, type SseEvent } from "../api";
import { renderMarkdown } from "../markdown";
import { ColHead } from "./ColHead";
import { applyProgress, applyResult, buildFromHistory, type Item, type Metrics, type Step } from "../timeline";

const fmtTime = (ts: number) => {
  const d = new Date(ts), t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${t}`;
};
const fullTime = (ts: number) => new Date(ts).toLocaleString();

const VERB: Record<string, string> = {
  Bash: "ran", Read: "read", Write: "wrote", Edit: "edited", MultiEdit: "edited", NotebookEdit: "edited",
  Glob: "glob", Grep: "grep", LS: "ls", WebFetch: "fetched", WebSearch: "searched", Task: "subagent",
};
const verb = (name: string) => VERB[name] ?? name.toLowerCase();
const category = (name: string): "read" | "search" | "edit" | "bash" | "web" | "task" | "other" => {
  if (name === "Read") return "read";
  if (name === "Grep" || name === "Glob" || name === "LS") return "search";
  if (name === "Edit" || name === "MultiEdit" || name === "Write" || name === "NotebookEdit") return "edit";
  if (name === "Bash") return "bash";
  if (name === "WebFetch" || name === "WebSearch") return "web";
  if (name === "Task") return "task";
  return "other";
};

const ICONS: Record<string, JSX.Element> = {
  read: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  bash: <><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>,
  web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" /></>,
  task: <><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
  other: <circle cx="12" cy="12" r="4" />,
};
const TIcon = ({ cat }: { cat: keyof typeof ICONS }) => (
  <svg className="tic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{ICONS[cat]}</svg>
);
const Chev = ({ open }: { open: boolean }) => (
  <svg className={`chev ${open ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
);
const Spin = () => <span className="spin" />;

/** Custom hook that animates new text character-by-character; pre-existing (persisted) text renders instantly without animation. */
function useTyped(text: string, animate?: boolean) {
  const [shown, setShown] = useState(animate ? "" : text);
  useEffect(() => {
    if (!animate) { setShown(text); return; }
    let i = 0; const step = Math.max(2, Math.ceil(text.length / 90));
    const id = window.setInterval(() => { i += step; setShown(text.slice(0, i)); if (i >= text.length) window.clearInterval(id); }, 18);
    return () => window.clearInterval(id);
  }, []);
  return shown;
}

/** Renders an agent reply bubble with optional typewriter animation and a cost/token/duration summary line. */
function AgentBubble({ text, animate, meta }: { text: string; animate?: boolean; meta?: Metrics }) {
  const shown = useTyped(text, animate);
  return (
    <>
      <div className="bubble ag md" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown || "…") }} />
      {meta && <div className="turn-meta"><span>⏱ {(meta.durationMs / 1000).toFixed(1)}s</span>{meta.tokens > 0 && <span>◇ {meta.tokens >= 1000 ? `${(meta.tokens / 1000).toFixed(1)}k` : meta.tokens} tokens</span>}<span>$ {meta.costUsd.toFixed(3)}</span></div>}
    </>
  );
}

/** Collapsible card that displays an agent thinking block, expanding live while the agent is running and auto-collapsing when done. */
function ThinkingThought({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(!!live);
  const shown = useTyped(text, live);
  useEffect(() => { if (!live) setOpen(false); }, [live]);
  const preview = text.replace(/\s+/g, " ").trim();
  return (
    <div className={`thought ${open ? "open" : ""}`}>
      <div className="thought-row" onClick={() => setOpen((o) => !o)}>
        <svg className="brain" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /></svg>
        <span className="ttl">{live ? "Thinking…" : "Thought"}</span>
        {!open && <span className="preview">{preview}</span>}
        <Chev open={open} />
      </div>
      {open && <div className="thought-body">{live ? shown : text}</div>}
    </div>
  );
}

/** Renders a tool step's detail payload as a syntax-highlighted diff (with +/- line coloring) or as plain preformatted output. */
function DetailPre({ detail, output }: { detail?: string; output?: string }) {
  if (detail) {
    return (
      <pre className="tstep-detail">{detail.split("\n").map((l, i) => (
        <div key={i} className={l.startsWith("+ ") ? "ln-add" : l.startsWith("- ") ? "ln-del" : ""}>{l || " "}</div>
      ))}</pre>
    );
  }
  return <pre className="tstep-detail">{output}</pre>;
}

/** Expandable row for a single agent tool use, showing its category icon, verb, summary, and optional detail output. */
function ToolStep({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(step.detail || step.output);
  return (
    <div className={`tstep ${open ? "open" : ""}`}>
      <div className={`tstep-row ${hasDetail ? "" : "flat"}`} onClick={() => hasDetail && setOpen((o) => !o)}>
        <TIcon cat={category(step.name)} />
        <span className="tstep-name">{verb(step.name)}</span>
        {step.summary && <span className="tstep-arg">{step.summary}</span>}
        {step.running
          ? <span className="run-pill"><Spin />running…</span>
          : step.ok === false
            ? <svg className="done-tick" style={{ color: "#f1707a" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="M18 6 6 18M6 6l12 12" /></svg>
            : <svg className="done-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
        <Chev open={open} />
      </div>
      {open && hasDetail && <DetailPre detail={step.detail} output={step.output} />}
    </div>
  );
}

/** Collapsible group of ToolStep rows summarizing all tool uses in a single agent turn. */
function Activity({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(true);
  const verbs = Array.from(new Set(steps.map((s) => verb(s.name)))).join(" · ");
  return (
    <div className={`activity ${open ? "open" : ""}`}>
      <div className="activity-head" onClick={() => setOpen((o) => !o)}>
        <svg className="tic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
        <span className="lbl">{verbs || "actions"}</span>
        <span className="count">· {steps.length}</span>
        <Chev open={open} />
      </div>
      {open && <div className="activity-body">{steps.map((s, i) => <ToolStep key={s.toolId || i} step={s} />)}</div>}
    </div>
  );
}

/** Renders a plan card listing the agent's todo items with completion checkmarks and an in-progress spinner. */
function TodoCard({ items }: { items: { content: string; status: string }[] }) {
  const done = items.filter((t) => t.status === "completed").length;
  return (
    <div className="todo">
      <div className="todo-head">
        <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>
        Plan <span className="tcount">{done} / {items.length}</span>
      </div>
      <ul className="todo-list">
        {items.map((t, i) => (
          <li key={i} className={t.status === "completed" ? "done" : t.status === "in_progress" ? "active" : ""}>
            <span className="box">
              {t.status === "completed"
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>
                : t.status === "in_progress" ? <Spin /> : null}
            </span>
            {t.content}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Renders a contextual notice chip — a retry spinner pill, a memory-save chip, or a compact section divider. */
function Notice({ noticeKind, text }: { noticeKind: "compact" | "memory" | "retry"; text: string }) {
  if (noticeKind === "retry") return <div className="pill retry"><Spin />{text}</div>;
  if (noticeKind === "memory") return (
    <div className="sys-chip">
      <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M5 8a4 4 0 0 1 7-2 4 4 0 0 1 7 2v8a4 4 0 0 1-7 2 4 4 0 0 1-7-2z" /></svg>
      {text}
    </div>
  );
  return <div className="divider">{text}</div>;
}

/** Expands a chat slash command into the instruction sent to the agent; returns null for a plain message. */
function resolveCommand(text: string): string | null {
  const m = /^\/delete\s+(.+)$/.exec(text.trim());
  if (m) return `Delete \`${m[1].trim()}\` from the vault (it may be a file or a folder), then do your vault housekeeping: remove any entry for it in index.md, append a concise line to log.md noting the deletion, and fix or flag any remaining references to it. Do not recreate it and make no unrelated changes.`;
  return null;
}

/** Renders the full chat column: message history, SSE-driven live updates, and the send input. */
export function Chat({ onSend, running, dirty, onCommit, onDiscard, autoRun }: {
  onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>;
  running: boolean; dirty: boolean; onCommit: () => void; onDiscard: () => void;
  autoRun?: { id: number; text: string } | null;
}) {
  const [msgs, setMsgs] = useState<Item[]>([]);
  useEffect(() => { api.history().then((h) => setMsgs(buildFromHistory(h))).catch(() => {}); }, []);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, running]);

  const submit = async (forced?: string) => {
    const raw = (forced ?? text).trim();
    if (!raw || running) return; // dirty no longer blocks — review-mode runs accumulate onto the draft
    if (forced === undefined) setText("");
    const instruction = resolveCommand(raw) ?? raw; // slash commands expand; the bubble still shows the raw command
    setMsgs((m) => [...m, { kind: "user", text: raw, ts: Date.now() }]);
    await onSend(instruction, (e) => {
      if (e.event === "progress") setMsgs((m) => applyProgress(m, e.data, Date.now()));
      else if (e.event === "result") setMsgs((m) => applyResult(m, e.data, Date.now()));
      else if (e.event === "error") setMsgs((m) => [...m, { kind: "error", text: e.data.message, ts: Date.now() }]);
    });
  };
  // Fire a programmatic run (e.g. the tree's /delete) once the chat is idle; runs during a
  // live run wait for it to finish. Last-wins if several are queued while a run is in flight.
  const lastAuto = useRef<number>(0);
  useEffect(() => {
    if (autoRun && autoRun.id !== lastAuto.current && !running) { lastAuto.current = autoRun.id; submit(autoRun.text); }
  }, [autoRun, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastIdx = msgs.length - 1;
  return (
    <div className="col chat">
      <ColHead title="Vault agent">
        {msgs.length > 0 && <button className="ghost sm" style={{ textTransform: "none", letterSpacing: 0 }} onClick={() => { api.clearHistory().catch(() => {}); setMsgs([]); }}>Clear</button>}
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
          switch (m.kind) {
            case "user": return (
              <div key={i} className="msg-wrap me">
                <div className="bubble me">{m.text}</div>
                <span className="msg-time" title={fullTime(m.ts)}>{fmtTime(m.ts)}</span>
              </div>
            );
            case "agent": return (
              <div key={i} className="msg-wrap ag">
                <AgentBubble text={m.text} animate={m.animate} meta={m.meta} />
                <span className="msg-time" title={fullTime(m.ts)}>{fmtTime(m.ts)}</span>
              </div>
            );
            case "thinking": return <ThinkingThought key={i} text={m.text} live={running && i === lastIdx} />;
            case "activity": return <Activity key={i} steps={m.steps} />;
            case "todos": return <TodoCard key={i} items={m.items} />;
            case "notice": return <Notice key={i} noticeKind={m.noticeKind} text={m.text} />;
            case "error": return (
              <div key={i} className="err-banner">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                <div><b>Run failed.</b> {m.text}</div>
              </div>
            );
          }
        })}
        {running && <div className="thinking"><span className="tdots"><i /><i /><i /></span></div>}
        <div ref={endRef} />
      </div>
      <div className="ctrl">
        <input className="input" value={text} disabled={running}
          placeholder={running ? "Working…" : "Talk to your vault…"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </div>
  );
}

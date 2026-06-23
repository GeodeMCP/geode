import { useEffect, useRef, useState } from "react";
import type { SseEvent } from "../api";
import { renderMarkdown } from "../markdown";
import { ColHead } from "./ColHead";

// ---- timeline item model ----------------------------------------------------
type Step = { toolId: string; name: string; summary?: string; detail?: string; output?: string; running?: boolean; ok?: boolean };
type Metrics = { durationMs: number; costUsd: number; tokens: number };
type Item =
  | { kind: "user"; text: string; ts: number }
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "activity"; steps: Step[]; ts: number }
  | { kind: "todos"; items: { content: string; status: string }[]; ts: number }
  | { kind: "notice"; noticeKind: "compact" | "memory" | "retry"; text: string; ts: number }
  | { kind: "agent"; text: string; ts: number; animate?: boolean; meta?: Metrics }
  | { kind: "error"; text: string; ts: number };

const STORE = "geode.chat.v2"; // v2: structured timeline items (v1 was flat who/text bubbles)
const loadMsgs = (): Item[] => {
  try {
    return (JSON.parse(localStorage.getItem(STORE) || "[]") as Item[]).map((m) => {
      if (m.kind === "agent") return { ...m, ts: m.ts ?? Date.now(), animate: false };
      if (m.kind === "activity") return { ...m, steps: m.steps.map((s) => ({ ...s, running: false })) };
      return { ...m, ts: m.ts ?? Date.now() };
    });
  } catch { return []; }
};

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

// Reveals text as if typed; pre-typed (persisted) text renders instantly.
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

function AgentBubble({ text, animate, meta }: { text: string; animate?: boolean; meta?: Metrics }) {
  const shown = useTyped(text, animate);
  return (
    <>
      <div className="bubble ag md" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown || "…") }} />
      {meta && <div className="turn-meta"><span>⏱ {(meta.durationMs / 1000).toFixed(1)}s</span>{meta.tokens > 0 && <span>◇ {meta.tokens >= 1000 ? `${(meta.tokens / 1000).toFixed(1)}k` : meta.tokens} tokens</span>}<span>$ {meta.costUsd.toFixed(3)}</span></div>}
    </>
  );
}

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

// ---- streaming reducers -----------------------------------------------------
function applyProgress(items: Item[], ev: any, ts: number): Item[] {
  const next = items.slice();
  const last = next[next.length - 1];
  switch (ev.type) {
    case "thinking":
      next.push({ kind: "thinking", text: ev.text, ts });
      return next;
    case "tool": {
      const step: Step = { toolId: ev.toolId, name: ev.name, summary: ev.summary, detail: ev.detail, running: true };
      if (last && last.kind === "activity") next[next.length - 1] = { ...last, steps: [...last.steps, step] };
      else next.push({ kind: "activity", steps: [step], ts });
      return next;
    }
    case "tool_result": {
      for (let i = next.length - 1; i >= 0; i--) {
        const it = next[i];
        if (it.kind === "activity") {
          const idx = it.steps.findIndex((s) => s.toolId === ev.toolId && s.running);
          if (idx >= 0) {
            const steps = it.steps.slice();
            steps[idx] = { ...steps[idx], running: false, ok: ev.ok, output: ev.output };
            next[i] = { ...it, steps };
            return next;
          }
        }
      }
      return next;
    }
    case "todos": {
      let userIdx = -1;
      for (let i = next.length - 1; i >= 0; i--) if (next[i].kind === "user") { userIdx = i; break; }
      for (let i = next.length - 1; i > userIdx; i--) if (next[i].kind === "todos") { next[i] = { kind: "todos", items: ev.items, ts }; return next; }
      next.push({ kind: "todos", items: ev.items, ts });
      return next;
    }
    case "notice":
      next.push({ kind: "notice", noticeKind: ev.kind, text: ev.text, ts });
      return next;
    case "text":
      next.push({ kind: "agent", text: ev.text, ts, animate: true });
      return next;
    default:
      return next;
  }
}

function applyResult(items: Item[], data: any, ts: number): Item[] {
  const text = (data.text || "").trim();
  const meta: Metrics | undefined = data.metrics;
  // any still-running step is finished once the run ends
  const next = items.map((it) => (it.kind === "activity" && it.steps.some((s) => s.running)
    ? { ...it, steps: it.steps.map((s) => (s.running ? { ...s, running: false } : s)) } : it));
  let lastAgent = -1;
  for (let i = next.length - 1; i >= 0; i--) if (next[i].kind === "agent") { lastAgent = i; break; }
  if (text && (lastAgent < 0 || (next[lastAgent] as any).text.trim() !== text)) {
    next.push({ kind: "agent", text, ts, animate: true, meta });
  } else if (lastAgent >= 0 && meta) {
    next[lastAgent] = { ...(next[lastAgent] as any), meta };
  }
  return next;
}

export function Chat({ onSend, running, dirty, onCommit, onDiscard }: {
  onSend: (instruction: string, onEvent: (e: SseEvent) => void) => Promise<void>;
  running: boolean; dirty: boolean; onCommit: () => void; onDiscard: () => void;
}) {
  const [msgs, setMsgs] = useState<Item[]>(loadMsgs);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, running]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(msgs.map((m) => (m.kind === "agent" ? (({ animate, ...r }) => r)(m) : m))));
    } catch { /* quota/private mode */ }
  }, [msgs]);

  const submit = async () => {
    const instruction = text.trim();
    if (!instruction || running || dirty) return;
    setText("");
    setMsgs((m) => [...m, { kind: "user", text: instruction, ts: Date.now() }]);
    await onSend(instruction, (e) => {
      if (e.event === "progress") setMsgs((m) => applyProgress(m, e.data, Date.now()));
      else if (e.event === "result") setMsgs((m) => applyResult(m, e.data, Date.now()));
      else if (e.event === "error") setMsgs((m) => [...m, { kind: "error", text: e.data.message, ts: Date.now() }]);
    });
  };

  const lastIdx = msgs.length - 1;
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
        <input className="input" value={text} disabled={running || dirty}
          placeholder={dirty ? "Commit or discard your changes first…" : running ? "Working…" : "Talk to your vault…"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </div>
  );
}

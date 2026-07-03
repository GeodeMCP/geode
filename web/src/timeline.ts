import type { TranscriptRecord } from "./api";

/** Represents a single tool-call step within an activity block, tracking its running state and output. */
export type Step = { toolId: string; name: string; summary?: string; detail?: string; output?: string; running?: boolean; ok?: boolean };
/** Cost and performance metrics attached to a completed agent response. */
export type Metrics = { durationMs: number; costUsd: number; tokens: number };
/** A discriminated union of all timeline item variants rendered in the chat view. */
export type Item =
  | { kind: "user"; text: string; ts: number; attachments?: string[] }
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "activity"; steps: Step[]; ts: number }
  | { kind: "todos"; items: { content: string; status: string }[]; ts: number }
  | { kind: "notice"; noticeKind: "compact" | "memory" | "retry"; text: string; ts: number }
  | { kind: "agent"; text: string; ts: number; animate?: boolean; meta?: Metrics }
  | { kind: "error"; text: string; ts: number };

/** Appends or updates a timeline item in response to a single in-flight SSE progress event. */
export function applyProgress(items: Item[], ev: any, ts: number): Item[] {
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

/** Finalises the timeline after a run completes by clearing running steps and attaching the agent's answer and metrics. */
export function applyResult(items: Item[], data: any, ts: number): Item[] {
  const text = (data.text || "").trim();
  const meta: Metrics | undefined = data.metrics;
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

// Rebuild the full timeline from server-stored records. Each item in a run shares the record ts; the
// final answer/steps render statically (animate stripped, running cleared) — same as a persisted reload.
/** Reconstructs the full static timeline from an array of persisted transcript records. */
export function buildFromHistory(records: TranscriptRecord[]): Item[] {
  let items: Item[] = [];
  for (const rec of records) {
    items.push({ kind: "user", text: rec.instruction, ts: rec.ts });
    for (const ev of rec.events) items = applyProgress(items, ev, rec.ts);
    if (rec.result) items = applyResult(items, rec.result, rec.ts);
    else if (rec.error) items.push({ kind: "error", text: rec.error, ts: rec.ts });
  }
  return items.map((it) => (it.kind === "agent" ? { ...it, animate: false } : it));
}

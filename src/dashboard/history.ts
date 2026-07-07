import type { TranscriptRecord } from "../transcripts.js";

/** Builds a compact "recent conversation" preamble from the last `limit` transcript turns (most recent last), or "" when there are none. */
export function buildHistoryPreamble(records: TranscriptRecord[], limit: number): string {
  const recent = records.slice(-limit);
  if (!recent.length) return "";
  const oneLine = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > 400 ? t.slice(0, 400) + "…" : t; };
  const lines = recent.map((r) => `You: ${oneLine(r.instruction)}\nVault: ${oneLine(r.result?.text ?? r.error ?? "")}`);
  return `Recent conversation (most recent last):\n${lines.join("\n")}`;
}

/** Formats an ISO timestamp as a short relative time: "just now", "2m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const delta = nowMs - new Date(iso).getTime();
  if (!isFinite(delta) || delta < 0) return "just now";
  const s = Math.floor(delta / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

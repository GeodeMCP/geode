export interface TreeNode { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] }
export interface SseEvent { event: string; data: any }

/** Parse a buffer of SSE text into complete events + the unparsed remainder. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    let event = "message", data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) events.push({ event, data: JSON.parse(data) });
  }
  return { events, rest };
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  login: (password: string) => json<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => json("/api/logout", { method: "POST" }),
  tree: () => json<TreeNode[]>("/api/tree"),
  file: (path: string) => json<{ content: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  diff: (path: string) => json<{ diff: string }>(`/api/diff?path=${encodeURIComponent(path)}`),
  status: () => json<{ modified: string[]; created: string[] }>("/api/status"),
  commit: (message?: string) => json<{ commit: string | null }>("/api/commit", { method: "POST", body: JSON.stringify({ message }) }),
  discard: () => json<{ ok: true }>("/api/discard", { method: "POST" }),
  /** Stream an agent run; calls onEvent for each SSE event until the stream closes. */
  async run(path: "/api/query" | "/api/remember", body: object, onEvent: (e: SseEvent) => void): Promise<void> {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSseChunk(buf); buf = rest;
      for (const e of events) onEvent(e);
    }
  },
};

/** Represents a node in the vault file tree, either a file or a directory. */
export interface TreeNode { name: string; path: string; type: "file" | "dir"; children?: TreeNode[] }
/** Describes a tool: its actions and per-connection configured status. */
export interface ToolView { id: string; name: string; type: string; description: string; actions: { name: string; description?: string; params: string[] }[]; connections: { label: string; title?: string; description?: string; configured: boolean }[]; requires: string[]; installed: boolean; permissions: { network?: unknown; filesystem?: string[] } | undefined; hosts: { approved: string[]; pending: string[] } }
/** A single Server-Sent Event with an event type name and parsed data payload. */
export interface SseEvent { event: string; data: any }
/** Documents a single MCP tool with its name, description, and parameter schema. */
export interface ToolDoc { name: string; description: string; params: { name: string; type: string; required: boolean }[] }
/** Connection details returned by the kernel including the MCP URL, auth token, and available tools. */
export interface ConnectInfo { mcpUrl: string; authToken: string; tools: ToolDoc[]; publicBaseUrl: string | null }
/** Authentication state indicating whether the server needs setup or login, and whether the user is currently authenticated. */
export interface AuthInfo { mode: "setup" | "login"; authed: boolean }
/** A vault "gap" page (frontmatter `type: gap`) describing a planned but unbuilt capability. */
export interface GapItem { title: string; kind?: string; description: string; path: string }
/** A persisted agent run record including the instruction, SSE events, result, and optional error. */
export interface TranscriptRecord {
  runId: string;
  ts: number;
  instruction: string;
  events: any[];
  result?: { text: string; metrics?: { durationMs: number; costUsd: number; tokens: number } };
  error?: string;
  attachments?: string[];
}

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

/** Fetches a JSON endpoint and throws a descriptive error when the response is not OK. */
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Namespace of typed API helpers that communicate with the kernel's HTTP endpoints. */
export const api = {
  authInfo: () => json<AuthInfo>("/api/auth-info"),
  setup: (email: string, password: string) => json<{ ok: true }>("/api/setup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => json<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => json("/api/logout", { method: "POST" }),
  tree: () => json<TreeNode[]>("/api/tree"),
  file: (path: string) => json<{ content: string }>(`/api/file?path=${encodeURIComponent(path)}`),
  diff: (path: string) => json<{ diff: string }>(`/api/diff?path=${encodeURIComponent(path)}`),
  status: () => json<{ modified: string[]; created: string[] }>("/api/status"),
  commit: (message?: string) => json<{ commit: string | null }>("/api/commit", { method: "POST", body: JSON.stringify({ message }) }),
  discard: () => json<{ ok: true }>("/api/discard", { method: "POST" }),
  history: () => json<TranscriptRecord[]>("/api/history"),
  connect: () => json<ConnectInfo>("/api/connect"),
  clearHistory: () => json<{ ok: true }>("/api/history", { method: "DELETE" }),
  tools: () => json<ToolView[]>("/api/tools"),
  tool: (id: string) => json<ToolView>(`/api/tools/${encodeURIComponent(id)}`),
  installTool: (id: string) => json<unknown>(`/api/tools/${encodeURIComponent(id)}/install`, { method: "POST" }),
  uninstallTool: (id: string) => json<{ ok: true }>(`/api/tools/${encodeURIComponent(id)}/uninstall`, { method: "POST" }),
  testAction: (id: string, action: string, params: Record<string, unknown>) => json<{ status: number; body: unknown }>(`/api/tools/${encodeURIComponent(id)}/test`, { method: "POST", body: JSON.stringify({ action, params }) }),
  /** Fetches a tool's declared hosts split into approved and pending. */
  toolHosts: (id: string) => json<{ approved: string[]; pending: string[] }>(`/api/tools/${encodeURIComponent(id)}/hosts`),
  /** Approves a host for a tool, returning the updated approved/pending split. */
  approveHost: (id: string, host: string) => json<{ approved: string[]; pending: string[] }>(`/api/tools/${encodeURIComponent(id)}/hosts/approve`, { method: "POST", body: JSON.stringify({ host }) }),
  /** Revokes a previously-approved host for a tool, returning the updated approved/pending split. */
  revokeHost: (id: string, host: string) => json<{ approved: string[]; pending: string[] }>(`/api/tools/${encodeURIComponent(id)}/hosts/${encodeURIComponent(host)}`, { method: "DELETE" }),
  /** Lists all tools with at least one pending (unapproved) declared host. */
  pendingHosts: () => json<{ tool: string; host: string }[]>("/api/hosts/pending"),
  secrets: () => json<{ ref: string; requiredBy: string[] }[]>("/api/secrets"),
  secretLink: (ref: string) => json<{ url: string }>(`/api/secrets/${encodeURIComponent(ref)}/link`, { method: "POST" }),
  deleteSecret: (ref: string) => json<{ ok: true }>(`/api/secrets/${encodeURIComponent(ref)}`, { method: "DELETE" }),
  gaps: () => json<{ gaps: GapItem[] }>("/api/gaps"),
  artifacts: () => json<{ path: string }[]>("/api/artifacts"),
  artifactDownload: (path: string) => `/api/artifacts/download?path=${encodeURIComponent(path)}`,
  artifactPublicLink: (path: string) => json<{ url: string }>("/api/artifacts/public-link", { method: "POST", body: JSON.stringify({ path }) }),
  writeFile: (path: string, content: string) => json<{ ok: true }>("/api/file", { method: "POST", body: JSON.stringify({ path, content }) }),
  deletePath: (path: string) => json<{ ok: true }>(`/api/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  /** Upload staged attachments (files carry their folder-relative path as the filename); returns the uploadId to pass to /api/query. */
  upload: async (items: { file: File; relPath: string }[]): Promise<{ added: string[] }> => {
    const fd = new FormData();
    for (const it of items) fd.append("files", it.file, it.relPath);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  /** Lists the files currently in the conversation's persistent attachment folder. */
  attachments: () => json<{ files: string[] }>("/api/attachments"),
  /** Empties the conversation's attachment folder. */
  clearAttachments: () => json<{ ok: true }>("/api/attachments", { method: "DELETE" }),
  /** Aborts the currently-running agent run (Stop / Esc). */
  cancel: () => json<{ ok: true }>("/api/cancel", { method: "POST" }),
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

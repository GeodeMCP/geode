/** A point-in-time view of MCP activity since the kernel started. */
export interface McpActivitySnapshot { lastAt: string | null; lastTool: string | null; count: number; }

/** Records and reports the most recent authenticated MCP request. */
export interface McpActivity {
  record(tool: string | null): void;
  snapshot(): McpActivitySnapshot;
}

/** Best-effort extraction of the invoked tool name from a JSON-RPC request body (tools/call → tool name, else the method). */
export function toolFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const method = (body as { method?: unknown }).method;
  if (typeof method !== "string") return null;
  if (method === "tools/call") {
    const name = (body as { params?: { name?: unknown } }).params?.name;
    return typeof name === "string" ? name : null;
  }
  return method;
}

/** Creates an in-memory MCP activity recorder; resets when the kernel restarts. */
export function createMcpActivity(now: () => string = () => new Date().toISOString()): McpActivity {
  let lastAt: string | null = null;
  let lastTool: string | null = null;
  let count = 0;
  return {
    record(tool) { lastAt = now(); if (tool) lastTool = tool; count += 1; },
    snapshot() { return { lastAt, lastTool, count }; },
  };
}

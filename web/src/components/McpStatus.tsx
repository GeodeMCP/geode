import { useEffect, useState } from "react";
import { api, type McpStatus as McpStatusData } from "../api";
import { relativeTime } from "../time";

/** Top-bar chip showing the kernel's most recent MCP activity (or "no calls yet"). Polls every ~10s; renders nothing on missing/failed fetch. */
export function McpStatus() {
  const [s, setS] = useState<McpStatusData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { api.mcpStatus?.().then((d) => { if (alive) setS(d); }).catch(() => {}); };
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!s) return null;
  if (s.lastAt === null) return <span className="chip mcp muted" title="No MCP calls since this kernel started">MCP · no calls yet</span>;
  return (
    <span className="chip mcp live" title={`${s.count} MCP call${s.count === 1 ? "" : "s"} since start`}>
      MCP · {relativeTime(s.lastAt)}{s.lastTool ? ` · ${s.lastTool}` : ""}
    </span>
  );
}

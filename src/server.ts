import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { query, type QueryDeps, type QueryResult } from "./query.js";
import { remember, type RememberArgs } from "./ingest.js";
import { eventText } from "./engine.js";
import { deriveCapabilities } from "./capabilities.js";
import { invoke, type InvokeArgs, type InvokeResult } from "./invoke.js";
import type { SecretStore } from "./secrets.js";
import type { ArtifactStore } from "./artifacts.js";
import { toolDescription } from "./toolCatalog.js";

export function checkAuth(header: string | undefined, token: string): boolean {
  const expected = `Bearer ${token}`;
  if (typeof header !== "string" || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// --- Tool handlers (unit-tested) ---

// Shared runner for agentic tools (query, remember): streams progress and
// returns text + structured content, or a structured error on throw.
async function runAgenticTool(
  extra: any,
  run: (onProgress: (m: string) => void) => Promise<QueryResult>,
  label: string,
) {
  let progress = 0;
  const token = extra?._meta?.progressToken;
  const onProgress = (message: string) => {
    if (token !== undefined && typeof extra?.sendNotification === "function") {
      void extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: ++progress, message },
      });
    }
  };
  try {
    const result = await run(onProgress);
    const text = result.artifacts && result.artifacts.length
      ? `${result.text}\n\nArtifacts:\n${result.artifacts.map((a) => `- ${a.url}`).join("\n")}`
      : result.text;
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { runId: result.runId, commit: result.commit, filesTouched: result.filesTouched, artifacts: result.artifacts },
    };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `${label} failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}

export interface QueryHandlerDeps {
  runQuery: (instruction: string, onProgress?: (m: string) => void) => Promise<QueryResult>;
}
export function makeQueryHandler(deps: QueryHandlerDeps) {
  return async (args: { instruction: string; workspace?: string }, extra: any) =>
    runAgenticTool(extra, (op) => deps.runQuery(args.instruction, op), "query");
}

export interface RememberHandlerDeps {
  runRemember: (args: RememberArgs, onProgress?: (m: string) => void) => Promise<QueryResult>;
}
export function makeRememberHandler(deps: RememberHandlerDeps) {
  return async (args: RememberArgs, extra: any) =>
    runAgenticTool(extra, (op) => deps.runRemember(args, op), "remember");
}

export interface ListCapabilitiesHandlerDeps {
  root: string;
  derive: (root: string) => Promise<{ text: string }>;
}
export function makeListCapabilitiesHandler(deps: ListCapabilitiesHandlerDeps) {
  return async (_args: unknown, _extra: unknown) => ({
    content: [{ type: "text" as const, text: (await deps.derive(deps.root)).text }],
  });
}

export interface InvokeHandlerDeps {
  invoke: (args: InvokeArgs) => Promise<InvokeResult>;
}
export function makeInvokeHandler(deps: InvokeHandlerDeps) {
  return async (args: InvokeArgs, _extra: any) => {
    try {
      const r = await deps.invoke(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        structuredContent: { status: r.status },
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `invoke failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  };
}

// --- Server assembly (integration) ---

export function buildMcpServer(queryDeps: QueryDeps, opts?: { secrets?: SecretStore; artifacts?: ArtifactStore }): McpServer {
  const server = new McpServer({ name: "geode-kernel", version: "0.1.0" });

  const queryHandler = makeQueryHandler({
    runQuery: (instruction, onProgress) => query(queryDeps, instruction, onProgress ? (ev) => { const s = eventText(ev); if (s) onProgress(s); } : undefined),
  });
  server.registerTool(
    "query",
    {
      description: toolDescription("query"),
      inputSchema: { instruction: z.string(), workspace: z.string().optional() },
    },
    queryHandler,
  );

  const rememberHandler = makeRememberHandler({
    runRemember: (args, onProgress) => remember(queryDeps, args, onProgress ? (ev) => { const s = eventText(ev); if (s) onProgress(s); } : undefined),
  });
  server.registerTool(
    "remember",
    {
      description: toolDescription("remember"),
      inputSchema: {
        content: z.string().describe("The knowledge to save — a distilled, self-contained learning, fact, or note (not a raw transcript); one idea is fine."),
        source: z.string().optional().describe("Where it came from, for provenance (e.g. 'Claude chat 2026-06-17', a URL, a person)."),
        title: z.string().optional().describe("A short hint of what this is about, to help filing (the agent refines it)."),
        workspace: z.string().optional(),
      },
    },
    rememberHandler,
  );

  const listCapabilitiesHandler = makeListCapabilitiesHandler({ root: queryDeps.workspace.root, derive: deriveCapabilities });
  server.registerTool(
    "list_capabilities",
    {
      description: toolDescription("list_capabilities"),
      inputSchema: {},
    },
    listCapabilitiesHandler,
  );

  if (opts?.secrets) {
    const secrets = opts.secrets;
    const invokeHandler = makeInvokeHandler({
      invoke: (a) => invoke({ root: queryDeps.workspace.root, secrets }, a),
    });
    server.registerTool(
      "invoke",
      {
        description: toolDescription("invoke"),
        inputSchema: { integration: z.string(), action: z.string(), params: z.record(z.string(), z.any()).optional(), workspace: z.string().optional() },
      },
      invokeHandler,
    );
  }

  return server;
}

export function buildHttpApp(makeServer: () => McpServer, authToken: string, artifacts?: ArtifactStore) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  if (artifacts) {
    app.get(/^\/artifacts\/(.+)$/, (req, res) => {
      // Express 5 already URI-decodes the captured path segment; decoding again
      // would throw URIError on a lone '%' (→ uncaught 500 + stack-trace leak).
      const relPath = (req.params as any)[0] as string;
      const authed = checkAuth(req.headers.authorization, authToken);
      const exp = typeof req.query.exp === "string" ? req.query.exp : undefined;
      const sig = typeof req.query.sig === "string" ? req.query.sig : undefined;
      const signed = exp !== undefined && sig !== undefined && artifacts.verifyPublic(relPath, exp, sig);
      if (!authed && !signed) {
        const sigAttempt = exp !== undefined || sig !== undefined;
        res.status(sigAttempt ? 403 : 401).json({ error: sigAttempt ? "invalid or expired signature" : "unauthorized" });
        return;
      }
      let abs: string;
      try { abs = artifacts.resolve(relPath); }
      catch { res.status(400).json({ error: "bad path" }); return; }
      res.sendFile(abs, (err: unknown) => {
        if (err && !res.headersSent) res.status(404).json({ error: "not found" });
      });
    });
  }
  app.post("/mcp", async (req, res) => {
    if (!checkAuth(req.headers.authorization, authToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
      }
    }
  });
  return app;
}

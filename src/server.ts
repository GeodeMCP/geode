import express from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { find as findOp, type FindArgs, type FindResult } from "./find.js";
import { delegate, type DelegateDeps, type DelegateResult } from "./delegate.js";
import { remember, type RememberArgs } from "./ingest.js";
import { listCapabilities } from "./capabilities.js";

export function checkAuth(header: string | undefined, token: string): boolean {
  const expected = `Bearer ${token}`;
  if (typeof header !== "string" || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// --- Tool handlers (unit-tested) ---

export interface FindHandlerDeps {
  root: string;
  find: (root: string, args: FindArgs) => Promise<FindResult>;
}

export function makeFindHandler(deps: FindHandlerDeps) {
  return async (args: FindArgs, _extra: unknown) => {
    const result = await deps.find(deps.root, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  };
}

// Shared runner for agentic tools (delegate, remember): streams progress and
// returns text + structured content, or a structured error on throw.
async function runAgenticTool(
  extra: any,
  run: (onProgress: (m: string) => void) => Promise<DelegateResult>,
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
    return {
      content: [{ type: "text" as const, text: result.text }],
      structuredContent: { runId: result.runId, commit: result.commit, filesTouched: result.filesTouched },
    };
  } catch (err) {
    return { content: [{ type: "text" as const, text: `${label} failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
}

export interface DelegateHandlerDeps {
  runDelegate: (instruction: string, onProgress?: (m: string) => void) => Promise<DelegateResult>;
}
export function makeDelegateHandler(deps: DelegateHandlerDeps) {
  return async (args: { instruction: string; workspace?: string }, extra: any) =>
    runAgenticTool(extra, (op) => deps.runDelegate(args.instruction, op), "delegate");
}

export interface RememberHandlerDeps {
  runRemember: (args: RememberArgs, onProgress?: (m: string) => void) => Promise<DelegateResult>;
}
export function makeRememberHandler(deps: RememberHandlerDeps) {
  return async (args: RememberArgs, extra: any) =>
    runAgenticTool(extra, (op) => deps.runRemember(args, op), "remember");
}

export interface ListCapabilitiesHandlerDeps {
  root: string;
  list: (root: string) => Promise<string>;
}
export function makeListCapabilitiesHandler(deps: ListCapabilitiesHandlerDeps) {
  return async (_args: unknown, _extra: unknown) => ({
    content: [{ type: "text" as const, text: await deps.list(deps.root) }],
  });
}

// --- Server assembly (integration) ---

export function buildMcpServer(delegateDeps: DelegateDeps): McpServer {
  const server = new McpServer({ name: "geode-kernel", version: "0.1.0" });

  const findHandler = makeFindHandler({ root: delegateDeps.workspace.root, find: findOp });
  server.registerTool(
    "find",
    {
      description: "Search and read from your Geode vault (your personal context, recipes and knowledge). Cheap and fast; returns raw content. Provide `path` to list a folder or read a file, or `query` to search file contents.",
      inputSchema: { path: z.string().optional(), query: z.string().optional(), maxResults: z.number().optional() },
    },
    findHandler,
  );

  const delegateHandler = makeDelegateHandler({
    runDelegate: (instruction, onProgress) => delegate(delegateDeps, instruction, onProgress),
  });
  server.registerTool(
    "delegate",
    {
      description: "Hand an open-ended task to your Geode vault's agent to execute (multi-step work using your context, scripts and tools). Streams progress; commits results to git.",
      inputSchema: { instruction: z.string(), workspace: z.string().optional() },
    },
    delegateHandler,
  );

  const rememberHandler = makeRememberHandler({
    runRemember: (args, onProgress) => remember(delegateDeps, args, onProgress),
  });
  server.registerTool(
    "remember",
    {
      description: "Save a distilled learning, fact, or note in your Geode vault. Give the essence — not a whole conversation; the vault agent integrates, dedups, and files it. Example — content: 'Client X wants invoices on the 1st, net-30.', source: 'call 2026-06-17'.",
      inputSchema: {
        content: z.string().describe("The knowledge to save — a distilled, self-contained learning, fact, or note (not a raw transcript); one idea is fine."),
        source: z.string().optional().describe("Where it came from, for provenance (e.g. 'Claude chat 2026-06-17', a URL, a person)."),
        title: z.string().optional().describe("A short hint of what this is about, to help filing (the agent refines it)."),
        workspace: z.string().optional(),
      },
    },
    rememberHandler,
  );

  const listCapabilitiesHandler = makeListCapabilitiesHandler({ root: delegateDeps.workspace.root, list: listCapabilities });
  server.registerTool(
    "list_capabilities",
    {
      description: "List what your Geode vault offers — recipes/skills and integrations with their actions. Cheap; call this to learn what the vault can do before delegating.",
      inputSchema: {},
    },
    listCapabilitiesHandler,
  );

  return server;
}

export function buildHttpApp(makeServer: () => McpServer, authToken: string) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
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

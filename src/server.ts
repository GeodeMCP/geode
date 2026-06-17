import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { find as findOp, type FindArgs, type FindResult } from "./find.js";
import { delegate, type DelegateDeps, type DelegateResult } from "./delegate.js";

export function checkAuth(header: string | undefined, token: string): boolean {
  return header === `Bearer ${token}`;
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

export interface DelegateHandlerDeps {
  runDelegate: (instruction: string, onProgress?: (m: string) => void) => Promise<DelegateResult>;
}

export function makeDelegateHandler(deps: DelegateHandlerDeps) {
  return async (args: { instruction: string; workspace?: string }, extra: any) => {
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
    const result = await deps.runDelegate(args.instruction, onProgress);
    return {
      content: [{ type: "text" as const, text: result.text }],
      structuredContent: { runId: result.runId, commit: result.commit, filesTouched: result.filesTouched },
    };
  };
}

// --- Server assembly (integration) ---

export function buildMcpServer(delegateDeps: DelegateDeps): McpServer {
  const server = new McpServer({ name: "geode-kernel", version: "0.1.0" });

  const findHandler = makeFindHandler({ root: delegateDeps.workspace.root, find: findOp });
  server.registerTool(
    "find",
    {
      description: "Search and read from your Geode vault (your personal context, recipes and knowledge). Cheap and fast; returns raw content. Provide `path` to list a folder or read a file, or `query` to search file contents.",
      inputSchema: { path: z.string().optional(), query: z.string().optional() },
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

  return server;
}

export function buildHttpApp(server: McpServer, authToken: string) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.post("/mcp", async (req, res) => {
    if (!checkAuth(req.headers.authorization, authToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return app;
}

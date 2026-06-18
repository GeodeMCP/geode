import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Workspace } from "../workspace.js";
import type { QueryResult } from "../query.js";
import type { RememberArgs } from "../ingest.js";
import { signSession, requireSession, setSessionCookie, clearSessionCookie } from "./session.js";
import { buildKnowledgeTree, parseStatus } from "./knowledge.js";
import { openSse } from "./sse.js";

export interface ApiDeps {
  sessionKey: Buffer;
  dashboardPassword: string;
  secure: boolean;
  workspace: Workspace;
  runQuery: (instruction: string, onProgress: (m: string) => void) => Promise<QueryResult>;
  runRemember: (args: RememberArgs, onProgress: (m: string) => void) => Promise<QueryResult>;
}

const SESSION_TTL = 86_400_000; // 24h

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();

  router.post("/login", (req: Request, res: Response) => {
    const password = String(req.body?.password ?? "");
    const a = Buffer.from(password), b = Buffer.from(deps.dashboardPassword);
    if (a.length !== b.length || !timingSafeEqual(a, b)) { res.status(401).json({ error: "invalid password" }); return; }
    setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL), deps.secure);
    res.json({ ok: true });
  });
  router.post("/logout", (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

  // everything below requires a session
  router.use(requireSession(deps.sessionKey));

  const stream = (run: (op: (m: string) => void) => Promise<QueryResult>) => async (_req: Request, res: Response) => {
    const sse = openSse(res);
    try {
      const result = await run((m) => sse.send("progress", { message: m }));
      sse.send("result", result);
    } catch (e) {
      sse.send("error", { message: e instanceof Error ? e.message : String(e) });
    } finally {
      sse.close();
    }
  };
  router.post("/query", (req, res) => stream((op) => deps.runQuery(String(req.body?.instruction ?? ""), op))(req, res));
  router.post("/remember", (req, res) => stream((op) => deps.runRemember(req.body ?? {}, op))(req, res));

  router.get("/tree", async (_req, res) => { res.json(await buildKnowledgeTree(deps.workspace.root)); });
  router.get("/status", async (_req, res) => { res.json(parseStatus(await deps.workspace.statusPorcelain())); });
  router.get("/file", async (req, res) => {
    try { res.json({ content: await deps.workspace.fileContent(String(req.query.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.get("/diff", async (req, res) => {
    try { res.json({ diff: await deps.workspace.diff(String(req.query.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.post("/commit", async (req, res) => {
    const commit = await deps.workspace.commitAll(String(req.body?.message || "dashboard: commit changes"));
    res.json({ commit });
  });
  router.post("/discard", async (_req, res) => { await deps.workspace.resetToHead(); res.json({ ok: true }); });

  return router;
}

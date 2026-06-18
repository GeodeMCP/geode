import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Workspace } from "../workspace.js";
import type { QueryResult } from "../query.js";
import type { RememberArgs } from "../ingest.js";
import type { SecretStore } from "../secrets.js";
import type { ArtifactStore } from "../artifacts.js";
import { signSession, requireSession, setSessionCookie, clearSessionCookie } from "./session.js";
import { buildKnowledgeTree, parseStatus } from "./knowledge.js";
import { openSse } from "./sse.js";
import { deriveCapabilities } from "../capabilities.js";
import { listIntegrations, getIntegration, listSecrets, listArtifacts } from "./ops.js";
import { mintSecretLink } from "./secretLinks.js";

export interface ApiDeps {
  sessionKey: Buffer;
  dashboardPassword: string;
  secure: boolean;
  workspace: Workspace;
  runQuery: (instruction: string, onProgress: (m: string) => void) => Promise<QueryResult>;
  runRemember: (args: RememberArgs, onProgress: (m: string) => void) => Promise<QueryResult>;
  linkKey: Buffer;
  secrets: Pick<SecretStore, "list" | "delete" | "set">;
  artifacts: Pick<ArtifactStore, "mintPublicUrl" | "resolve">;
  artifactsDir: string;
  baseUrl: string;
  invoke: (args: { integration: string; action: string; params?: Record<string, unknown> }) => Promise<{ status: number; body: unknown }>;
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

  router.get("/capabilities", async (_req, res) => { res.json(await deriveCapabilities(deps.workspace.root)); });

  router.get("/integrations", async (_req, res) => { res.json(await listIntegrations(deps.workspace.root, deps.secrets)); });
  router.get("/integrations/:name", async (req, res) => {
    try { res.json(await getIntegration(deps.workspace.root, req.params.name, deps.secrets)); }
    catch { res.status(404).json({ error: "unknown integration" }); }
  });
  router.post("/integrations/:name/test", async (req, res) => {
    try { res.json(await deps.invoke({ integration: req.params.name, action: String(req.body?.action ?? ""), params: req.body?.params ?? {} })); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  router.get("/secrets", async (_req, res) => { res.json(await listSecrets(deps.workspace.root, deps.secrets)); });
  router.post("/secrets/:ref/link", (req, res) => {
    res.json({ url: `${deps.baseUrl}/auth/s/${mintSecretLink(deps.linkKey, req.params.ref, 600_000)}` });
  });
  router.delete("/secrets/:ref", async (req, res) => { await deps.secrets.delete(req.params.ref); res.json({ ok: true }); });

  router.get("/artifacts", async (_req, res) => { res.json(listArtifacts(deps.artifactsDir)); });
  router.get("/artifacts/download", (req, res) => {
    try { res.sendFile(deps.artifacts.resolve(String(req.query.path ?? "")), (err) => { if (err && !res.headersSent) res.status(404).json({ error: "not found" }); }); }
    catch { res.status(400).json({ error: "bad path" }); }
  });
  router.post("/artifacts/public-link", (req, res) => {
    try { res.json({ url: deps.artifacts.mintPublicUrl(String(req.body?.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  return router;
}

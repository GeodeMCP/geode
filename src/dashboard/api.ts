import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { Workspace } from "../workspace.js";
import type { QueryResult } from "../query.js";
import type { ProgressEvent } from "../engine.js";
import type { RememberArgs } from "../ingest.js";
import type { SecretStore } from "../secrets.js";
import type { ArtifactStore } from "../artifacts.js";
import type { TranscriptStore, TranscriptRecord } from "../transcripts.js";
import type { AccountStore } from "../account.js";
import { signSession, requireSession, setSessionCookie, clearSessionCookie, sessionFromCookie } from "./session.js";
import { createRateLimiter } from "./rateLimit.js";
import { buildKnowledgeTree, parseStatus } from "./knowledge.js";
import { openSse } from "./sse.js";
import { deriveCapabilities } from "../capabilities.js";
import { listIntegrations, getIntegration, listSecrets, listArtifacts } from "./ops.js";
import { mintSecretLink } from "./secretLinks.js";
import { TOOL_CATALOG } from "../toolCatalog.js";

export interface ApiDeps {
  sessionKey: Buffer;
  secure: boolean;
  workspace: Workspace;
  runQuery: (instruction: string, onProgress: (event: ProgressEvent) => void) => Promise<QueryResult>;
  runRemember: (args: RememberArgs, onProgress: (event: ProgressEvent) => void) => Promise<QueryResult>;
  linkKey: Buffer;
  secrets: Pick<SecretStore, "list" | "delete" | "set">;
  artifacts: Pick<ArtifactStore, "mintPublicUrl" | "resolve">;
  transcripts: TranscriptStore;
  artifactsDir: string;
  baseUrl: string;
  authToken: string;
  accounts: AccountStore;
  invoke: (args: { integration: string; action: string; params?: Record<string, unknown> }) => Promise<{ status: number; body: unknown }>;
}

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const SESSION_TTL = 86_400_000; // 24h

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const loginLimiter = createRateLimiter({ limit: 8, windowMs: 60_000 });
  const ipKey = (req: Request) => (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress || "unknown";

  router.get("/auth-info", (req, res) => {
    res.json({ mode: deps.accounts.hasOwner() ? "login" : "setup", authed: !!sessionFromCookie(deps.sessionKey, req.headers.cookie) });
  });

  router.post("/setup", (req, res) => {
    if (deps.accounts.hasOwner()) { res.status(409).json({ error: "owner already exists" }); return; }
    const lim = loginLimiter.check(ipKey(req)); if (!lim.ok) { res.status(429).json({ error: "too many attempts", retryAfter: lim.retryAfter }); return; }
    try {
      const p = deps.accounts.createOwner({ email: String(req.body?.email ?? ""), password: String(req.body?.password ?? "") });
      setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, p.id), deps.secure);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  router.post("/login", (req, res) => {
    const lim = loginLimiter.check(ipKey(req)); if (!lim.ok) { res.status(429).json({ error: "too many attempts", retryAfter: lim.retryAfter }); return; }
    if (!deps.accounts.hasOwner()) { res.status(403).json({ error: "no owner configured; complete setup" }); return; }
    const p = deps.accounts.verify(String(req.body?.email ?? ""), String(req.body?.password ?? ""));
    if (!p) { res.status(401).json({ error: "invalid credentials" }); return; }
    setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, p.id), deps.secure);
    res.json({ ok: true });
  });
  router.post("/logout", (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

  // everything below requires a session
  router.use(requireSession(deps.sessionKey));

  const stream = (
    run: (op: (event: ProgressEvent) => void) => Promise<QueryResult>,
    onDone?: (events: ProgressEvent[], outcome: { result: QueryResult } | { error: string }) => Promise<void>,
  ) => async (_req: Request, res: Response) => {
    const sse = openSse(res);
    const events: ProgressEvent[] = [];
    try {
      const result = await run((event) => { events.push(event); sse.send("progress", event); });
      sse.send("result", result);
      try { await onDone?.(events, { result }); } catch (e) { console.error("transcript append failed:", e); }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sse.send("error", { message });
      try { await onDone?.(events, { error: message }); } catch (err) { console.error("transcript append failed:", err); }
    } finally {
      sse.close();
    }
  };
  router.post("/query", (req, res) => {
    const instruction = String(req.body?.instruction ?? "");
    stream(
      (op) => deps.runQuery(instruction, op),
      async (events, outcome) => {
        // Safe to append serially: the runManager queue serializes runs, so two /query records never interleave.
        const rec: TranscriptRecord = "result" in outcome
          ? { runId: outcome.result.runId, ts: Date.now(), instruction, events, result: { text: outcome.result.text, metrics: outcome.result.metrics } }
          : { runId: randomUUID(), ts: Date.now(), instruction, events, error: outcome.error };
        await deps.transcripts.append(rec);
      },
    )(req, res);
  });
  router.post("/remember", (req, res) => stream((op) => deps.runRemember(req.body ?? {}, op))(req, res));

  router.get("/tree", async (_req, res) => { res.json(await buildKnowledgeTree(deps.workspace.root)); });
  router.get("/status", async (_req, res) => { res.json(parseStatus(await deps.workspace.statusPorcelain())); });
  router.get("/file", async (req, res) => {
    try { res.json({ content: await deps.workspace.fileContent(String(req.query.path ?? "")) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.post("/file", async (req, res) => {
    const path = String(req.body?.path ?? "");
    if (!path) { res.status(400).json({ error: "path required" }); return; }
    try { await deps.workspace.writeFile(path, String(req.body?.content ?? "")); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.delete("/file", async (req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) { res.status(400).json({ error: "path required" }); return; }
    try { await deps.workspace.deletePath(path); res.json({ ok: true }); }
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

  router.get("/history", async (_req, res) => { res.json(await deps.transcripts.list()); });
  router.delete("/history", async (_req, res) => { await deps.transcripts.clear(); res.json({ ok: true }); });

  router.get("/connect", (_req, res) => {
    const isLoopback = /(^https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(deps.baseUrl);
    res.json({ mcpUrl: `${deps.baseUrl}/mcp`, authToken: deps.authToken, tools: TOOL_CATALOG, publicBaseUrl: isLoopback ? null : deps.baseUrl });
  });

  router.get("/capabilities", async (_req, res) => { res.json(await deriveCapabilities(deps.workspace.root)); });

  router.get("/integrations", async (_req, res) => { res.json(await listIntegrations(deps.workspace.root, deps.secrets)); });
  router.get("/integrations/:name", async (req, res) => {
    if (!SAFE_NAME.test(req.params.name)) { res.status(404).json({ error: "unknown integration" }); return; }
    try { res.json(await getIntegration(deps.workspace.root, req.params.name, deps.secrets)); }
    catch { res.status(404).json({ error: "unknown integration" }); }
  });
  router.post("/integrations/:name/test", async (req, res) => {
    if (!SAFE_NAME.test(req.params.name)) { res.status(404).json({ error: "unknown integration" }); return; }
    try { res.json(await deps.invoke({ integration: req.params.name, action: String(req.body?.action ?? ""), params: req.body?.params ?? {} })); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  router.get("/secrets", async (_req, res) => { res.json(await listSecrets(deps.workspace.root, deps.secrets)); });
  router.post("/secrets/:ref/link", (req, res) => {
    if (!SAFE_NAME.test(req.params.ref)) { res.status(400).json({ error: "invalid ref" }); return; }
    res.json({ url: `${deps.baseUrl}/auth/s/${mintSecretLink(deps.linkKey, req.params.ref, 600_000)}` });
  });
  router.delete("/secrets/:ref", async (req, res) => {
    if (!SAFE_NAME.test(req.params.ref)) { res.status(400).json({ error: "invalid ref" }); return; }
    await deps.secrets.delete(req.params.ref); res.json({ ok: true });
  });

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

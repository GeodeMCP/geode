import { Router, type Request, type Response } from "express";
import busboy from "busboy";
import { randomUUID } from "node:crypto";
import type { Workspace } from "../workspace.js";
import type { QueryResult } from "../query.js";
import type { ProgressEvent } from "../engine.js";
import type { RememberArgs } from "../ingest.js";
import type { SecretStore } from "../secrets.js";
import type { ArtifactStore } from "../artifacts.js";
import type { TranscriptStore, TranscriptRecord } from "../transcripts.js";
import type { AccountStore } from "../account.js";
import type { AttachmentStore, UploadFile } from "./uploads.js";
import { signSession, requireSession, setSessionCookie, clearSessionCookie, sessionFromCookie } from "./session.js";
import { createRateLimiter } from "./rateLimit.js";
import { buildKnowledgeTree, parseStatus } from "./knowledge.js";
import { buildHistoryPreamble } from "./history.js";
import { openSse } from "./sse.js";
import { listTools, getTool, listSecrets, listArtifacts } from "./ops.js";
import { mintSecretLink } from "./secretLinks.js";
import { TOOL_CATALOG } from "../toolCatalog.js";
import { installTool, uninstallTool } from "../installer.js";
import { loadTool } from "../tools.js";
import { readApproval, approveHost, revokeHost } from "../approvals.js";
import { hostStatus } from "../hostPolicy.js";
import { deriveCapabilities } from "../capabilities.js";
import type { Docker } from "../docker.js";
import { regenerateArtifacts } from "../rebuild.js";

/** Dependencies injected into the API router, covering auth, workspace, query execution, and storage. */
export interface ApiDeps {
  sessionKey: Buffer;
  secure: boolean;
  workspace: Workspace;
  /** Extended: forwards attachment dirs (and, later, conversation history) into the run. */
  runQuery: (instruction: string, onProgress: (event: ProgressEvent) => void, opts?: { attachmentDirs?: string[]; attachmentFiles?: string[]; history?: string }) => Promise<QueryResult>;
  runRemember: (args: RememberArgs, onProgress: (event: ProgressEvent) => void) => Promise<QueryResult>;
  /** Aborts the currently-running agent run (Stop / Esc from the dashboard). */
  cancelQuery: () => void;
  linkKey: Buffer;
  secrets: Pick<SecretStore, "get" | "list" | "delete" | "set">;
  artifacts: Pick<ArtifactStore, "mintPublicUrl" | "resolve">;
  transcripts: TranscriptStore;
  artifactsDir: string;
  baseUrl: string;
  authToken: string;
  accounts: AccountStore;
  invoke: (args: { tool: string; action: string; connection?: string; params?: Record<string, unknown> }) => Promise<{ status: number; body: unknown }>;
  /** Docker interface for cli tool install/uninstall. */
  docker: Docker;
  /** Directory where installed cli tool state is stored (e.g. ~/.geode/tools). */
  toolsDir: string;
  /** Persistent per-conversation attachment folder backing the chat's attachment intake. */
  attachments: AttachmentStore;
}

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const SESSION_TTL = 86_400_000; // 24h

/** Builds and returns the Express router that handles all /api endpoints for the dashboard. */
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

  router.post("/uploads", (req, res) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024, files: 1000 } });
    const files: UploadFile[] = [];
    const pending: Promise<void>[] = [];
    bb.on("file", (_field, stream, info) => {
      const bufs: Buffer[] = [];
      stream.on("data", (d: Buffer) => bufs.push(d));
      pending.push(new Promise<void>((resolve) => stream.on("end", () => { files.push({ relPath: info.filename, buffer: Buffer.concat(bufs) }); resolve(); })));
    });
    bb.on("close", () => { void (async () => {
      await Promise.all(pending);
      try { const added = await deps.attachments.add(files); res.json({ added }); }
      catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
    })(); });
    bb.on("error", (e: unknown) => { if (!res.headersSent) res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); });
    req.pipe(bb);
  });
  router.get("/attachments", async (_req, res) => { res.json({ files: await deps.attachments.list() }); });
  router.delete("/attachments", async (_req, res) => { await deps.attachments.clear(); res.json({ ok: true }); });
  router.post("/cancel", (_req, res) => { deps.cancelQuery(); res.json({ ok: true }); });

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
  router.post("/query", async (req, res) => {
    const instruction = String(req.body?.instruction ?? "");
    // Labels of attachments added WITH this message (for the transcript/display); the agent reads the whole folder.
    const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as unknown[]).map(String) : undefined;
    const staged = await deps.attachments.list();
    const attachmentDirs = staged.length ? [deps.attachments.dir] : undefined;
    const history = buildHistoryPreamble(await deps.transcripts.list(), 6);
    stream(
      (op) => deps.runQuery(instruction, op, { attachmentDirs, attachmentFiles: staged, history }),
      async (events, outcome) => {
        // Safe to append serially: the runManager queue serializes runs, so two /query records never interleave.
        const rec: TranscriptRecord = "result" in outcome
          ? { runId: outcome.result.runId, ts: Date.now(), instruction, events, result: { text: outcome.result.text, metrics: outcome.result.metrics } }
          : { runId: randomUUID(), ts: Date.now(), instruction, events, error: outcome.error };
        if (attachments && attachments.length) rec.attachments = attachments;
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
    try { await regenerateArtifacts(deps.workspace.root, deps.secrets); }
    catch (e) { console.error("graph rebuild failed (non-fatal):", e instanceof Error ? e.message : String(e)); }
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

  router.get("/tools", async (_req, res) => { res.json(await listTools(deps.workspace.root, deps.toolsDir, deps.secrets)); });
  router.get("/tools/:id", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { res.json(await getTool(deps.workspace.root, deps.toolsDir, req.params.id, deps.secrets)); }
    catch { res.status(404).json({ error: "unknown tool" }); }
  });
  router.post("/tools/:id/install", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try {
      await loadTool(deps.workspace.root, req.params.id);
      // Installing builds the image but grants NO hosts — egress is approved separately, per host, via /hosts/approve.
      const state = await installTool({ root: deps.workspace.root, toolsDir: deps.toolsDir, docker: deps.docker }, req.params.id, {});
      res.json(state);
    } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.post("/tools/:id/uninstall", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { await uninstallTool({ toolsDir: deps.toolsDir, docker: deps.docker }, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.post("/tools/:id/test", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { res.json(await deps.invoke({ tool: req.params.id, action: String(req.body?.action ?? ""), connection: req.body?.connection, params: req.body?.params ?? {} })); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });

  const hostsOf = async (id: string) => {
    const manifest = await loadTool(deps.workspace.root, id);
    const { approvedHosts } = await readApproval(deps.toolsDir, id);
    return hostStatus(manifest, approvedHosts);
  };
  router.get("/tools/:id/hosts", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { res.json(await hostsOf(req.params.id)); } catch { res.status(404).json({ error: "unknown tool" }); }
  });
  router.post("/tools/:id/hosts/approve", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    const host = String(req.body?.host ?? "").trim().toLowerCase();
    if (!host) { res.status(400).json({ error: "host required" }); return; }
    try { await approveHost(deps.toolsDir, req.params.id, host); res.json(await hostsOf(req.params.id)); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.delete("/tools/:id/hosts/:host", async (req, res) => {
    if (!SAFE_NAME.test(req.params.id)) { res.status(404).json({ error: "unknown tool" }); return; }
    try { await revokeHost(deps.toolsDir, req.params.id, decodeURIComponent(req.params.host)); res.json(await hostsOf(req.params.id)); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
  });
  router.get("/hosts/pending", async (_req, res) => {
    const out: { tool: string; host: string }[] = [];
    for (const t of await listTools(deps.workspace.root, deps.toolsDir, deps.secrets)) {
      for (const host of t.hosts.pending) out.push({ tool: t.id, host });
    }
    res.json(out);
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

  router.get("/gaps", async (_req, res) => {
    res.json({ gaps: (await deriveCapabilities(deps.workspace.root, deps.secrets)).gaps });
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

import { loadConfig } from "./config.js";
import { createWorkspace } from "./workspace.js";
import { createEventLog } from "./eventLog.js";
import { createRunManager } from "./runManager.js";
import { claudeAgentEngine } from "./engine.js";
import { resolveSandboxPolicy } from "./agentSandbox.js";
import { CONSTITUTION } from "./constitution.js";
import { buildMcpServer, buildHttpApp } from "./server.js";
import type { QueryDeps } from "./query.js";
import { query } from "./query.js";
import { remember } from "./ingest.js";
import { seedVault, ensureArtifactsIgnored } from "./seed.js";
import { createSecretStore, loadOrCreateKey } from "./secrets.js";
import { regenerateArtifacts } from "./rebuild.js";
import { createArtifactStore } from "./artifacts.js";
import { createTranscriptStore } from "./transcripts.js";
import { createAttachmentStore } from "./dashboard/uploads.js";
import { createAccountStore } from "./account.js";
import { invoke } from "./invoke.js";
import { realDocker } from "./docker.js";
import { realMcpConnector } from "./mcpProxy.js";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { mountDashboard } from "./dashboard/index.js";
import { createOAuth } from "./oauth/tokens.js";
import { createOAuthRouter } from "./oauth/router.js";
import { createRateLimiter } from "./dashboard/rateLimit.js";

/** Bootstraps the full GeodeMCP server: loads config, initialises all stores, and starts the MCP and HTTP listeners. */
async function main() {
  const config = loadConfig();
  const workspace = createWorkspace(config.workspaceRoot);
  await workspace.init();

  const seeded = await seedVault(config.workspaceRoot);
  const ignoreChanged = await ensureArtifactsIgnored(config.workspaceRoot);
  if (seeded.length > 0 || ignoreChanged) {
    const note = seeded.length > 0 ? ` (${seeded.join(", ")})` : "";
    await workspace.commitAll(`chore: seed vault scaffolds${note}`);
  }

  const secrets = createSecretStore({
    dir: config.secretsDir,
    key: loadOrCreateKey(config.secretsDir, process.env.GEODE_SECRETS_KEY),
  });

  // Startup build: so a freshly cloned/seeded vault has a current graph. Deterministic — this
  // only produces a diff (and a commit) when vault content changed since the last build.
  await regenerateArtifacts(config.workspaceRoot, secrets);
  await workspace.commitAll("graph: rebuild at startup");

  // Distinct key material for HMAC artifact-URL signing (separate from the AES secret key).
  const artifacts = createArtifactStore({
    dir: config.artifactsDir,
    baseUrl: config.baseUrl,
    signKey: loadOrCreateKey(join(config.secretsDir, "sign"), process.env.GEODE_SIGN_KEY),
  });
  const transcripts = createTranscriptStore(config.transcriptsDir);
  const attachments = createAttachmentStore({ dir: join(homedir(), ".geode", "uploads") });

  const queryDeps: QueryDeps = {
    workspace,
    engine: claudeAgentEngine,
    runManager: createRunManager({ maxRuntimeMs: config.maxRuntimeMs, queueLimit: config.queueLimit }),
    eventLog: createEventLog(config.workspaceRoot),
    systemPrompt: CONSTITUTION,
    sandboxPolicy: resolveSandboxPolicy(process.env, config.workspaceRoot),
    model: config.model,
    artifactsDir: config.artifactsDir,
    baseUrl: config.baseUrl,
    secrets,
  };

  const oauth = createOAuth({ signKey: loadOrCreateKey(join(config.secretsDir, "oauth"), process.env.GEODE_OAUTH_KEY), baseUrl: config.baseUrl });
  const app = buildHttpApp(
    () => buildMcpServer(queryDeps, { secrets, artifacts, toolsDir: join(homedir(), ".geode", "tools"), docker: realDocker(), connector: realMcpConnector() }),
    config.authToken,
    artifacts,
    { verify: (t) => !!oauth.verifyAccessToken(t), resourceMetadataUrl: `${config.baseUrl}/.well-known/oauth-protected-resource` },
  );

  const sessionKey = loadOrCreateKey(join(config.secretsDir, "session"), process.env.GEODE_SESSION_KEY);
  const accounts = createAccountStore(config.accountDir);
  if (!accounts.hasOwner() && config.ownerEmail && config.ownerPassword) {
    try { accounts.createOwner({ email: config.ownerEmail, password: config.ownerPassword }); console.log(`Owner account bootstrapped: ${config.ownerEmail}`); }
    catch (e) { console.error("owner bootstrap failed:", e instanceof Error ? e.message : String(e)); }
  }
  // Mount the OAuth routes BEFORE the dashboard so /authorize, /token, /register, /.well-known/* are not
  // swallowed by the dashboard SPA fallback (which catches non-/api,/auth,/mcp,/artifacts GETs).
  app.use(createOAuthRouter({ oauth, accounts, sessionKey, baseUrl: config.baseUrl, secure: config.baseUrl.startsWith("https://"), rateLimit: createRateLimiter({ limit: 10, windowMs: 60_000 }) }));
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
  mountDashboard(app, {
    sessionKey,
    accounts,
    secure: config.baseUrl.startsWith("https://"),
    workspace,
    webDir,
    runQuery: (instruction, onProgress, opts) => query(queryDeps, instruction, onProgress, { commit: false, attachmentDirs: opts?.attachmentDirs, history: opts?.history }),
    cancelQuery: () => queryDeps.runManager.cancel(),
    runRemember: (args, onProgress) => remember(queryDeps, args, onProgress, { commit: false }),
    secrets,
    artifacts,
    transcripts,
    attachments,
    artifactsDir: config.artifactsDir,
    baseUrl: config.baseUrl,
    authToken: config.authToken,
    invoke: (args) => invoke({ root: workspace.root, secrets, toolsDir: join(homedir(), ".geode", "tools"), docker: realDocker(), connector: realMcpConnector() }, args),
    linkKey: loadOrCreateKey(join(config.secretsDir, "link"), process.env.GEODE_LINK_KEY),
  });
  console.log(`Dashboard enabled at ${config.baseUrl}/`);

  app.listen(config.port, () => {
    console.log(`Geode kernel listening on http://localhost:${config.port}/mcp (workspace: ${config.workspaceRoot})`);
  });
}

main().catch((err) => {
  console.error("Kernel failed to start:", err);
  process.exit(1);
});

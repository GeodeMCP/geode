import { loadConfig } from "./config.js";
import { createWorkspace } from "./workspace.js";
import { createEventLog } from "./eventLog.js";
import { createRunManager } from "./runManager.js";
import { claudeAgentEngine } from "./engine.js";
import { CONSTITUTION } from "./constitution.js";
import { buildMcpServer, buildHttpApp } from "./server.js";
import type { QueryDeps } from "./query.js";
import { query } from "./query.js";
import { remember } from "./ingest.js";
import { seedVault, ensureArtifactsIgnored } from "./seed.js";
import { createSecretStore, loadOrCreateKey } from "./secrets.js";
import { createArtifactStore } from "./artifacts.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mountDashboard } from "./dashboard/index.js";

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
  // Distinct key material for HMAC artifact-URL signing (separate from the AES secret key).
  const artifacts = createArtifactStore({
    dir: config.artifactsDir,
    baseUrl: config.baseUrl,
    signKey: loadOrCreateKey(join(config.secretsDir, "sign"), process.env.GEODE_SIGN_KEY),
  });

  const queryDeps: QueryDeps = {
    workspace,
    engine: claudeAgentEngine,
    runManager: createRunManager({ maxRuntimeMs: config.maxRuntimeMs, queueLimit: config.queueLimit }),
    eventLog: createEventLog(config.workspaceRoot),
    systemPrompt: CONSTITUTION,
    model: config.model,
    artifactsDir: config.artifactsDir,
    baseUrl: config.baseUrl,
  };

  const app = buildHttpApp(() => buildMcpServer(queryDeps, { secrets, artifacts }), config.authToken, artifacts);

  if (config.dashboardPassword) {
    const sessionKey = loadOrCreateKey(join(config.secretsDir, "session"), process.env.GEODE_SESSION_KEY);
    const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
    mountDashboard(app, {
      sessionKey,
      dashboardPassword: config.dashboardPassword,
      secure: config.baseUrl.startsWith("https://"),
      workspace,
      webDir,
      runQuery: (instruction, onProgress) => query(queryDeps, instruction, onProgress, { commit: false }),
      runRemember: (args, onProgress) => remember(queryDeps, args, onProgress, { commit: false }),
    });
    console.log(`Dashboard enabled at ${config.baseUrl}/`);
  }

  app.listen(config.port, () => {
    console.log(`Geode kernel listening on http://localhost:${config.port}/mcp (workspace: ${config.workspaceRoot})`);
  });
}

main().catch((err) => {
  console.error("Kernel failed to start:", err);
  process.exit(1);
});

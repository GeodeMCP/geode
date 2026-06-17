import { loadConfig } from "./config.js";
import { createWorkspace } from "./workspace.js";
import { createEventLog } from "./eventLog.js";
import { createRunManager } from "./runManager.js";
import { claudeAgentEngine } from "./engine.js";
import { CONSTITUTION } from "./constitution.js";
import { buildMcpServer, buildHttpApp } from "./server.js";
import type { DelegateDeps } from "./delegate.js";
import { seedVault } from "./seed.js";

async function main() {
  const config = loadConfig();
  const workspace = createWorkspace(config.workspaceRoot);
  await workspace.init();

  const seeded = await seedVault(config.workspaceRoot);
  if (seeded.length > 0) await workspace.commitAll(`chore: seed vault scaffolds (${seeded.join(", ")})`);

  const delegateDeps: DelegateDeps = {
    workspace,
    engine: claudeAgentEngine,
    runManager: createRunManager({ maxRuntimeMs: config.maxRuntimeMs, queueLimit: config.queueLimit }),
    eventLog: createEventLog(config.workspaceRoot),
    systemPrompt: CONSTITUTION,
    model: config.model,
  };

  const app = buildHttpApp(() => buildMcpServer(delegateDeps), config.authToken);
  app.listen(config.port, () => {
    console.log(`Geode kernel listening on http://localhost:${config.port}/mcp (workspace: ${config.workspaceRoot})`);
  });
}

main().catch((err) => {
  console.error("Kernel failed to start:", err);
  process.exit(1);
});

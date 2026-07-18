import { loadConfig } from "./config.js";
import { createSecretStore, loadOrCreateKey } from "./secrets.js";
import { regenerateArtifacts } from "./rebuild.js";

/** Entry point for the graph CLI: rebuilds the capability graph for the configured vault and writes it to disk. */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const root = config.workspaceRoot;
  const secrets = createSecretStore({
    dir: config.secretsDir,
    key: loadOrCreateKey(config.secretsDir, process.env.GEODE_SECRETS_KEY),
  });
  const graph = await regenerateArtifacts(root, secrets);
  console.log(`graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

import { loadConfig } from "./config.js";
import { createSecretStore, loadOrCreateKey } from "./secrets.js";
import { lintVault } from "./lint.js";

/** Entry point for the lint CLI: runs the deterministic health pass over the configured vault and prints an English report. */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const root = config.workspaceRoot;
  const secrets = createSecretStore({
    dir: config.secretsDir,
    key: loadOrCreateKey(config.secretsDir, process.env.GEODE_SECRETS_KEY),
  });
  const health = await lintVault(root, secrets);

  if (health.strayWikilinks.length === 0 && health.orphans.length === 0 && health.brokenLinks.length === 0) {
    console.log("Vault health: OK (0 issues)");
    return;
  }

  console.log(`Vault health: ${root}`);
  if (health.strayWikilinks.length > 0) {
    console.log(`Stray wikilinks (${health.strayWikilinks.length}):`);
    for (const w of health.strayWikilinks) console.log(`  - ${w.path} (${w.count})`);
  }
  if (health.orphans.length > 0) {
    console.log(`Orphan nodes (${health.orphans.length}):`);
    for (const o of health.orphans) console.log(`  - ${o.id} (${o.path})`);
  }
  if (health.brokenLinks.length > 0) {
    console.log(`Broken links (${health.brokenLinks.length}):`);
    for (const b of health.brokenLinks) console.log(`  - ${b.path} -> ${b.link}`);
  }
  process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

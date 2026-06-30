import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { realDocker } from "./docker.js";
import { loadTool } from "./tools.js";
import { installTool, uninstallTool } from "./installer.js";

/** Prompts the owner for a yes/no answer on stdin; resolves true only if the user types 'y'. */
function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === "y"); });
  });
}

/** Entry point for the tool CLI: dispatches install and uninstall subcommands for owner-gated cli tool management. */
async function main(): Promise<void> {
  const [cmd, id] = process.argv.slice(2);
  if (!cmd || !id) {
    console.log("usage: tool <install|uninstall> <id>");
    process.exit(1);
  }

  const config = loadConfig(process.env);
  const root = config.workspaceRoot;
  const toolsDir = join(homedir(), ".geode", "tools");
  const docker = realDocker();

  switch (cmd) {
    case "install": {
      const m = await loadTool(root, id);
      const perms = m.permissions ?? {};
      console.log(`\nTool: ${m.name} (${id})`);
      console.log(`Requested permissions:`);
      if (Object.keys(perms).length === 0) {
        console.log("  (none)");
      } else {
        for (const [k, v] of Object.entries(perms)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
      const confirmed = await promptConfirm("\nApprove and install? [y/N] ");
      if (!confirmed) { console.log("Aborted."); process.exit(1); }
      const state = await installTool({ root, toolsDir, docker }, id, perms);
      console.log(`Installed ${id} (image: ${state.image}, approved: ${state.approvedAt})`);
      break;
    }
    case "uninstall": {
      await uninstallTool({ toolsDir, docker }, id);
      console.log(`Uninstalled ${id}`);
      break;
    }
    default:
      console.log("usage: tool <install|uninstall> <id>");
      process.exit(1);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { loadConfig } from "./config.js";
import { createSecretStore, loadOrCreateKey } from "./secrets.js";

/** Prompts the user for input on stdin while suppressing echo, then resolves with the entered string. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const mutedStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding as BufferEncoding);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output: mutedStdout, terminal: true });
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
    muted = true;
  });
}

/** Entry point for the secret CLI: dispatches set, list, and rm subcommands against the encrypted secret store. */
async function main(): Promise<void> {
  const [cmd, ref] = process.argv.slice(2);
  const config = loadConfig(process.env);
  const store = createSecretStore({
    dir: config.secretsDir,
    key: loadOrCreateKey(config.secretsDir, process.env.GEODE_SECRETS_KEY),
  });
  switch (cmd) {
    case "set": {
      if (!ref) throw new Error("usage: secret set <REF>");
      const value = await promptHidden(`Value for ${ref}: `);
      if (!value) throw new Error("empty value — nothing saved");
      await store.set(ref, value);
      console.log(`saved ${ref}`);
      break;
    }
    case "list": {
      const names = await store.list();
      console.log(names.length ? names.join("\n") : "(no secrets set)");
      break;
    }
    case "rm": {
      if (!ref) throw new Error("usage: secret rm <REF>");
      await store.delete(ref);
      console.log(`removed ${ref}`);
      break;
    }
    default:
      console.log("usage: secret <set|list|rm> [REF]");
      process.exit(1);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

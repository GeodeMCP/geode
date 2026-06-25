import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createAccountStore } from "./account.js";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc as BufferEncoding); cb(); } });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true });
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    muted = true;
  });
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const config = loadConfig(process.env);
  const store = createAccountStore(config.accountDir);
  switch (cmd) {
    case "show":
      console.log(store.getOwner()?.email ?? "(no owner — first-run setup pending)");
      break;
    case "create": {
      if (!arg) throw new Error("usage: owner create <email>");
      const pw = await promptHidden(`Password for ${arg}: `);
      store.createOwner({ email: arg, password: pw });
      console.log(`created owner ${arg}`);
      break;
    }
    case "set-password": {
      const owner = store.getOwner();
      if (!owner) throw new Error("no owner yet — use: owner create <email>");
      const pw = await promptHidden(`New password for ${owner.email}: `);
      store.setPassword(owner.email, pw);
      console.log(`updated password for ${owner.email}`);
      break;
    }
    case "reset": {
      const file = join(config.accountDir, "account.json");
      if (existsSync(file)) rmSync(file);
      console.log("owner reset — first-run setup will run again");
      break;
    }
    default:
      console.log("usage: owner <show|create <email>|set-password|reset>");
      process.exit(1);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

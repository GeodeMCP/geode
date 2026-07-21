import { claudeAgentEngine } from "../engine.js";
import { runJob, type RunnerIo } from "./runJob.js";
import { createLineDecoder, encodeLine } from "./framing.js";
import type { BrokerOut, RunnerOut } from "./protocol.js";

const decode = createLineDecoder();
let handler: (m: BrokerOut) => void = () => {};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  for (const msg of decode(chunk)) handler(msg as BrokerOut);
});

const io: RunnerIo = {
  onBrokerMessage: (h) => { handler = h; },
  send: (m: RunnerOut) => { process.stdout.write(encodeLine(m)); },
};

runJob(claudeAgentEngine, io)
  .then(() => process.exit(0))
  .catch((e) => { process.stderr.write(String(e instanceof Error ? e.stack : e) + "\n"); process.exit(1); });

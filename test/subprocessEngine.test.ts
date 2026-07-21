import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSubprocessEngine } from "../src/subprocessEngine.js";

let fakeRunner: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "geode-fakerunner-"));
  fakeRunner = join(dir, "runner.mjs");
  // Reads one job line, emits two events + done. If the job's instruction is "hang",
  // it emits one event then waits, and on receiving a cancel line, exits. If the
  // instruction is "crash", it emits one event then kills itself with SIGKILL
  // before sending done, simulating a real crash/OOM.
  writeFileSync(fakeRunner, `
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  const lines = buf.split("\\n"); buf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = JSON.parse(l);
    if (m.kind === "cancel") { process.stdout.write(JSON.stringify({kind:"event",event:{type:"text",text:"cancelled"}})+"\\n"); process.stdout.write(JSON.stringify({kind:"done"})+"\\n"); process.exit(0); }
    if (m.kind === "job") {
      process.stdout.write(JSON.stringify({kind:"event",event:{type:"text",text:m.instruction}})+"\\n");
      if (m.instruction === "crash") { process.kill(process.pid, "SIGKILL"); return; }
      if (m.instruction === "hang") return;
      process.stdout.write(JSON.stringify({kind:"event",event:{type:"result",text:"final"}})+"\\n");
      process.stdout.write(JSON.stringify({kind:"done"})+"\\n");
    }
  }
});
`);
});

const runOpts = (instruction: string, abortController = new AbortController()) => ({
  instruction, cwd: "/v", systemPrompt: "", abortController,
});

describe("subprocess engine adapter", () => {
  it("marshals a job and streams events to completion", async () => {
    const engine = createSubprocessEngine({ runnerCommand: process.execPath, runnerArgs: [fakeRunner] });
    const events = [];
    for await (const ev of engine(runOpts("hello"))) events.push(ev);
    expect(events).toEqual([{ type: "text", text: "hello" }, { type: "result", text: "final" }]);
  });

  it("forwards abort as a cancel message to the runner", async () => {
    const ac = new AbortController();
    const engine = createSubprocessEngine({ runnerCommand: process.execPath, runnerArgs: [fakeRunner] });
    const events = [];
    const it = engine(runOpts("hang", ac))[Symbol.asyncIterator]();
    const first = await it.next();               // "hang" event received
    expect(first.value).toEqual({ type: "text", text: "hang" });
    ac.abort();                                   // -> writes {kind:"cancel"}
    const rest = [];
    for (let n = await it.next(); !n.done; n = await it.next()) rest.push(n.value);
    expect(rest).toContainEqual({ type: "text", text: "cancelled" });
  });

  it("throws when the runner is killed by a signal before completion", async () => {
    const engine = createSubprocessEngine({ runnerCommand: process.execPath, runnerArgs: [fakeRunner] });
    const drain = async () => {
      for await (const _ev of engine(runOpts("crash"))) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow();
  });
});

import { spawn, type SpawnOptions } from "node:child_process";
import type { Engine, EngineEvent } from "./engine.js";
import { createLineDecoder, encodeLine } from "./runner/framing.js";
import type { JobMessage, RunnerOut } from "./runner/protocol.js";

/** Builds an Engine that runs the real engine in a spawned runner subprocess, marshaling options in and events out. */
export function createSubprocessEngine(config: { runnerCommand: string; runnerArgs: string[]; spawnOptions?: SpawnOptions }): Engine {
  return async function* (opts) {
    const child = spawn(config.runnerCommand, config.runnerArgs, { stdio: ["pipe", "pipe", "inherit"], ...config.spawnOptions });
    const { abortController, ...serializable } = opts;
    const onAbort = () => { try { child.stdin!.write(encodeLine({ kind: "cancel" })); } catch { /* child may be gone */ } };
    abortController.signal.addEventListener("abort", onAbort);

    // Async queue: stdout decoder pushes RunnerOut; the generator pulls.
    const queue: RunnerOut[] = [];
    let notify: (() => void) | null = null;
    let ended = false;
    let failure: Error | null = null;
    const wake = () => { notify?.(); notify = null; };
    const decode = createLineDecoder();
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (c: string) => { for (const m of decode(c)) queue.push(m as RunnerOut); wake(); });
    child.on("error", (e) => { failure = e; ended = true; wake(); });
    child.on("close", (code) => { if (code && code !== 0 && !failure) failure = new Error(`runner exited with code ${code}`); ended = true; wake(); });

    const jobMsg: JobMessage = { kind: "job", ...serializable };
    child.stdin!.write(encodeLine(jobMsg));

    try {
      for (;;) {
        while (queue.length) {
          const m = queue.shift()!;
          if (m.kind === "event") yield m.event as EngineEvent;
          else if (m.kind === "done") return;
          else if (m.kind === "error") throw new Error(m.message);
        }
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>((r) => { notify = r; });
      }
    } finally {
      abortController.signal.removeEventListener("abort", onAbort);
      if (!child.killed) child.kill();
    }
  };
}

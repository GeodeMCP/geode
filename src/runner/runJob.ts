import type { Engine } from "../engine.js";
import type { BrokerOut, RunnerOut } from "./protocol.js";

/** The runner's transport seam: subscribe to broker messages, and send messages back. */
export interface RunnerIo {
  onBrokerMessage: (handler: (m: BrokerOut) => void) => void;
  send: (m: RunnerOut) => void;
}

/** Waits for the job, runs the engine streaming events, honors a cancel control message, and signals done/error. */
export async function runJob(engine: Engine, io: RunnerIo): Promise<void> {
  const abortController = new AbortController();
  const job = await new Promise<Extract<BrokerOut, { kind: "job" }>>((resolve) => {
    io.onBrokerMessage((m) => {
      if (m.kind === "job") resolve(m);
      else if (m.kind === "cancel") abortController.abort();
    });
  });
  try {
    const { kind: _kind, ...opts } = job;
    for await (const event of engine({ ...opts, abortController })) {
      io.send({ kind: "event", event });
    }
    io.send({ kind: "done" });
  } catch (e) {
    io.send({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

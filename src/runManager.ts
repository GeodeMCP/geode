/** Serialises agent runs in a queue, enforcing a per-run timeout and a maximum queue depth. */
export interface RunManager {
  run<T>(fn: (abortController: AbortController, runId: string) => Promise<T>): Promise<T>;
  /** Aborts the currently-running run, if any (e.g. the owner presses Stop / Esc). */
  cancel(): void;
}

/** Creates a RunManager that chains runs sequentially, aborts them after maxRuntimeMs, and rejects new runs when the queue exceeds queueLimit. */
export function createRunManager(opts: { maxRuntimeMs: number; queueLimit: number }): RunManager {
  let tail: Promise<unknown> = Promise.resolve();
  let queued = 0;
  let counter = 0;
  let active: AbortController | null = null;

  return {
    run<T>(fn: (abortController: AbortController, runId: string) => Promise<T>): Promise<T> {
      if (queued >= opts.queueLimit) {
        return Promise.reject(new Error("kernel busy: run queue is full"));
      }
      queued++;
      const result = tail.then(async () => {
        const runId = `run-${++counter}`;
        const ac = new AbortController();
        active = ac;
        const timer = setTimeout(() => ac.abort(new Error("run timeout")), opts.maxRuntimeMs);
        try {
          return await fn(ac, runId);
        } finally {
          clearTimeout(timer);
          queued--;
          if (active === ac) active = null;
        }
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    cancel() { active?.abort(new Error("cancelled by user")); },
  };
}

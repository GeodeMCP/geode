export interface RunManager {
  run<T>(fn: (abortController: AbortController, runId: string) => Promise<T>): Promise<T>;
}

export function createRunManager(opts: { maxRuntimeMs: number; queueLimit: number }): RunManager {
  let tail: Promise<unknown> = Promise.resolve();
  let queued = 0;
  let counter = 0;

  return {
    run<T>(fn: (abortController: AbortController, runId: string) => Promise<T>): Promise<T> {
      if (queued >= opts.queueLimit) {
        return Promise.reject(new Error("kernel busy: run queue is full"));
      }
      queued++;
      const result = tail.then(async () => {
        const runId = `run-${++counter}`;
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new Error("run timeout")), opts.maxRuntimeMs);
        try {
          return await fn(ac, runId);
        } finally {
          clearTimeout(timer);
          queued--;
        }
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

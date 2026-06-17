import { expect, test } from "vitest";
import { createRunManager } from "../src/runManager.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("serializes runs (single-flight)", async () => {
  const rm = createRunManager({ maxRuntimeMs: 1000, queueLimit: 10 });
  const order: string[] = [];
  const a = rm.run(async () => { order.push("a-start"); await sleep(30); order.push("a-end"); });
  const b = rm.run(async () => { order.push("b-start"); await sleep(5); order.push("b-end"); });
  await Promise.all([a, b]);
  expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
});

test("assigns incrementing run ids", async () => {
  const rm = createRunManager({ maxRuntimeMs: 1000, queueLimit: 10 });
  const ids: string[] = [];
  await rm.run(async (_ac, id) => { ids.push(id); });
  await rm.run(async (_ac, id) => { ids.push(id); });
  expect(ids).toEqual(["run-1", "run-2"]);
});

test("rejects when the queue is full", async () => {
  const rm = createRunManager({ maxRuntimeMs: 1000, queueLimit: 1 });
  const first = rm.run(async () => { await sleep(30); });
  await expect(rm.run(async () => {})).rejects.toThrow(/busy/);
  await first;
});

test("aborts a run that exceeds max runtime", async () => {
  const rm = createRunManager({ maxRuntimeMs: 20, queueLimit: 10 });
  const aborted = await rm.run(async (ac) => {
    await sleep(60);
    return ac.signal.aborted;
  });
  expect(aborted).toBe(true);
});

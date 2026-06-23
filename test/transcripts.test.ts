// test/transcripts.test.ts
import { expect, test } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTranscriptStore, type TranscriptRecord } from "../src/transcripts.js";

const rec = (over: Partial<TranscriptRecord> = {}): TranscriptRecord => ({
  runId: "r1", ts: 1000, instruction: "do X",
  events: [{ type: "text", text: "hi" } as any],
  result: { text: "done" }, ...over,
});

test("append then list round-trips records in order; dir is created lazily", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "geode-tx-")), "nested"); // not yet created
  const store = createTranscriptStore(dir);
  await store.append(rec({ runId: "r1" }));
  await store.append(rec({ runId: "r2", error: "boom", result: undefined }));
  const all = await store.list();
  expect(all.map((r) => r.runId)).toEqual(["r1", "r2"]);
  expect(all[1].error).toBe("boom");
  rmSync(dir, { recursive: true, force: true });
});

test("list on a missing file returns []", async () => {
  const store = createTranscriptStore(join(tmpdir(), "geode-tx-missing-" + Math.random().toString(36).slice(2)));
  expect(await store.list()).toEqual([]);
});

test("clear empties the thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-tx-"));
  const store = createTranscriptStore(dir);
  await store.append(rec());
  await store.clear();
  expect(await store.list()).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("a corrupt line is skipped, not thrown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-tx-"));
  const store = createTranscriptStore(dir);
  await store.append(rec({ runId: "good" }));
  appendFileSync(join(dir, "transcript.jsonl"), "{ this is not json\n");
  const all = await store.list();
  expect(all.map((r) => r.runId)).toEqual(["good"]);
  rmSync(dir, { recursive: true, force: true });
});

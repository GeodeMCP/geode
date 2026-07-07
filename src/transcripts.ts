import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProgressEvent, Metrics } from "./engine.js";

/** Shape of a single persisted run record stored in the transcript log. */
export interface TranscriptRecord {
  runId: string;
  ts: number;                 // server time (ms epoch) when written
  instruction: string;
  events: ProgressEvent[];
  result?: { text: string; metrics?: Metrics };
  error?: string;
  attachments?: string[];
}

/** Interface for appending, listing, and clearing transcript records in a persistent JSONL store. */
export interface TranscriptStore {
  append(record: TranscriptRecord): Promise<void>;
  list(): Promise<TranscriptRecord[]>;
  clear(): Promise<void>;
}

// JSONL, one record per line. Machine-local; not in the vault git. Runs are serialized by the
// runManager queue, so synchronous appends never interleave (mirrors eventLog.ts).
/** Creates a TranscriptStore backed by a JSONL file in the given directory, skipping corrupt lines on read. */
export function createTranscriptStore(dir: string): TranscriptStore {
  const file = join(dir, "transcript.jsonl");
  const ensureDir = () => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); };
  return {
    async append(record) {
      ensureDir();
      appendFileSync(file, JSON.stringify(record) + "\n");
    },
    async list() {
      if (!existsSync(file)) return [];
      const out: TranscriptRecord[] = [];
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as TranscriptRecord); } catch { /* skip a half-written / corrupt line */ }
      }
      return out;
    },
    async clear() {
      ensureDir();
      writeFileSync(file, "");
    },
  };
}

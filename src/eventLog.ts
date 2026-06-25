import { appendFileSync } from "node:fs";
import { join } from "node:path";

/** Shape of a single entry appended to the event log. */
export interface EventLogEntry {
  runId: string;
  instruction: string;
  status: "ok" | "error";
  commit?: string | null;
  summary?: string;
  error?: string;
}

/** Interface for appending structured run records to a markdown log file. */
export interface EventLog {
  append(entry: EventLogEntry): Promise<void>;
}

/** Creates an EventLog that appends formatted markdown entries to log.md in the given root directory. */
export function createEventLog(root: string, now: () => string = () => new Date().toISOString()): EventLog {
  const file = join(root, "log.md");
  return {
    async append(entry) {
      const head = `## [${now()}] ${entry.runId} | ${entry.status}${entry.commit ? ` | ${entry.commit}` : ""}`;
      const body = entry.status === "ok"
        ? `- instruction: ${entry.instruction}\n- result: ${entry.summary ?? ""}\n`
        : `- instruction: ${entry.instruction}\n- error: ${entry.error ?? ""}\n`;
      appendFileSync(file, `${head}\n${body}\n`);
    },
  };
}

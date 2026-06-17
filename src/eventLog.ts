import { appendFileSync } from "node:fs";
import { join } from "node:path";

export interface EventLogEntry {
  runId: string;
  instruction: string;
  status: "ok" | "error";
  commit?: string | null;
  summary?: string;
  error?: string;
}

export interface EventLog {
  append(entry: EventLogEntry): Promise<void>;
}

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

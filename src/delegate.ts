import type { Engine } from "./engine.js";
import type { EventLog } from "./eventLog.js";
import type { RunManager } from "./runManager.js";
import type { Workspace } from "./workspace.js";

export interface DelegateDeps {
  workspace: Workspace;
  engine: Engine;
  runManager: RunManager;
  eventLog: EventLog;
  systemPrompt: string;
  model?: string;
}

export interface DelegateResult {
  runId: string;
  text: string;
  commit: string | null;
  filesTouched: string[];
}

const truncate = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function delegate(
  deps: DelegateDeps,
  instruction: string,
  onProgress?: (message: string) => void,
): Promise<DelegateResult> {
  return deps.runManager.run(async (abortController, runId) => {
    if (!(await deps.workspace.isClean())) await deps.workspace.resetToHead();
    const before = await deps.workspace.head();
    let finalText = "";
    try {
      for await (const ev of deps.engine({
        instruction,
        cwd: deps.workspace.root,
        systemPrompt: deps.systemPrompt,
        model: deps.model,
        abortController,
      })) {
        if (ev.type === "progress") onProgress?.(ev.text);
        else finalText = ev.text;
      }
      const commit = await deps.workspace.commitAll(`delegate ${runId}: ${truncate(instruction, 60)}`);
      const filesTouched = commit ? await deps.workspace.changedFilesSince(before) : [];
      await deps.eventLog.append({ runId, instruction, status: "ok", commit, summary: truncate(finalText) });
      // Persist the event-log entry itself: it is written after the agent commit, so it would
      // otherwise stay uncommitted and be wiped by the next run's clean/reset.
      await deps.workspace.commitAll(`delegate ${runId}: log`);
      return { runId, text: finalText, commit, filesTouched };
    } catch (err) {
      await deps.workspace.resetToHead();
      await deps.eventLog.append({ runId, instruction, status: "error", error: String(err) });
      await deps.workspace.commitAll(`delegate ${runId}: log (error)`);
      throw err;
    }
  });
}

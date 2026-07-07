import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Engine, ProgressEvent, Metrics } from "./engine.js";
import type { EventLog } from "./eventLog.js";
import type { RunManager } from "./runManager.js";
import type { Workspace } from "./workspace.js";
import { buildSkillsFooter } from "./skills.js";
import { buildOverlay } from "./overlay.js";
import { buildSandboxSettings, type SandboxPolicy } from "./agentSandbox.js";
import { fragmentFor, type AgentRole } from "./constitution.js";

/** Dependencies injected into a query call, including the workspace, engine, and supporting services. */
export interface QueryDeps {
  workspace: Workspace;
  engine: Engine;
  runManager: RunManager;
  eventLog: EventLog;
  systemPrompt: string;
  // Required (not optional) so a run can never silently ship unconfined: to run the agent without a
  // sandbox you must pass a policy with enabled:false (GEODE_SANDBOX_DISABLE=1), not omit it.
  sandboxPolicy: SandboxPolicy;
  model?: string;
  artifactsDir?: string;
  baseUrl?: string;
}

/** Result returned by a completed query run, including the agent's text output and commit metadata. */
export interface QueryResult {
  runId: string;
  text: string;
  commit: string | null;
  filesTouched: string[];
  artifacts?: { path: string; url: string }[];
  metrics?: Metrics;
}

/** Recursively lists all file paths under an artifacts directory, relative to that directory and using forward slashes. */
function listArtifacts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

const truncate = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Assembles the full system prompt for a run: shared core + role fragment + vault overlay + skills footer. */
export function composeSystemPrompt(deps: Pick<QueryDeps, "systemPrompt" | "workspace">, role: AgentRole): string {
  return deps.systemPrompt + fragmentFor(role) + buildOverlay(deps.workspace.root) + buildSkillsFooter(deps.workspace.root);
}

/** Runs an instruction through the engine inside a managed run, commits the result, and logs the outcome. */
export async function query(
  deps: QueryDeps,
  instruction: string,
  onProgress?: (event: ProgressEvent) => void,
  opts?: { commit?: boolean; attachmentDirs?: string[]; history?: string; role?: AgentRole },
): Promise<QueryResult> {
  return deps.runManager.run(async (abortController, runId) => {
    const review = opts?.commit === false;
    // Review mode (dashboard): NEVER auto-reset — accumulate onto whatever is in the working tree
    // (a prior agent draft and/or manual Viewer edits). The human's Discard is the only reset.
    // Auto-commit mode (MCP): a dirty tree means a pending human draft — commit it as a checkpoint
    // first (never wipe it), so this run's own changes commit cleanly on top.
    if (!review && !(await deps.workspace.isClean())) {
      await deps.workspace.commitAll(`dashboard-draft: checkpoint before ${runId}`);
    }
    const before = await deps.workspace.head();
    const artifactsBefore = deps.artifactsDir ? new Set(listArtifacts(deps.artifactsDir)) : new Set<string>();
    let finalText = "";
    let metrics: Metrics | undefined;
    try {
      const attachmentNote = opts?.attachmentDirs?.length
        ? `Attachments for this request are staged (read-only) at: ${opts.attachmentDirs.join(", ")}. Inspect them there; never assume other paths. For an onboarding request, follow your onboard-workspace skill: if you have NOT yet proposed a plan for this, inspect and PROPOSE a filing plan (what goes where, which tools/skills to author, which secrets they must set), then STOP and end your turn with a yes/no question — write nothing yet. But if you ALREADY proposed a plan (see the recent conversation) and the owner is now approving it (e.g. "go on", "ga door", "ja", "proceed"), EXECUTE it now: create and edit the vault files per your plan, keep index.md/log.md current, and report what you filed. If they only asked a question about the attachment, just answer it.\n\n`
        : "";
      const historyNote = opts?.history ? `${opts.history}\n\n` : "";
      const engineInstruction = `${historyNote}${attachmentNote}${instruction}`;
      for await (const ev of deps.engine({
        instruction: engineInstruction,
        cwd: deps.workspace.root,
        systemPrompt: composeSystemPrompt(deps, opts?.role ?? (opts?.attachmentDirs?.length ? "librarian" : "desk")),
        model: deps.model,
        abortController,
        sandbox: buildSandboxSettings(deps.sandboxPolicy, opts?.attachmentDirs),
      })) {
        if (ev.type === "result") { finalText = ev.text; metrics = ev.metrics; }
        else onProgress?.(ev);
      }
      if (opts?.commit === false) {
        // Review mode (dashboard): leave changes uncommitted for the human to Commit/Verwerp.
        const filesTouched = await deps.workspace.uncommittedChanges();
        return { runId, text: finalText, commit: null, filesTouched, metrics };
      }
      const commit = await deps.workspace.commitAll(`query ${runId}: ${truncate(instruction, 60)}`);
      const filesTouched = commit ? await deps.workspace.changedFilesSince(before) : [];
      await deps.eventLog.append({ runId, instruction, status: "ok", commit, summary: truncate(finalText) });
      // Persist the event-log entry itself: it is written after the agent commit, so it would
      // otherwise stay uncommitted and be wiped by the next run's clean/reset.
      await deps.workspace.commitAll(`query ${runId}: log`);
      let artifacts: { path: string; url: string }[] | undefined;
      if (deps.artifactsDir && deps.baseUrl) {
        const base = deps.baseUrl;
        artifacts = listArtifacts(deps.artifactsDir)
          .filter((a) => !artifactsBefore.has(a))
          .map((p) => ({ path: p, url: `${base}/artifacts/${p}` }));
      }
      return { runId, text: finalText, commit, filesTouched, artifacts, metrics };
    } catch (err) {
      // Review mode: leave the partial edits on the tree for the human to inspect/keep/discard, and
      // do NOT commit an error-log entry (commitAll would sweep up the accumulated draft). Just rethrow.
      if (!review) {
        await deps.workspace.resetToHead();
        await deps.eventLog.append({ runId, instruction, status: "error", error: String(err) });
        await deps.workspace.commitAll(`query ${runId}: log (error)`);
      }
      throw err;
    }
  });
}

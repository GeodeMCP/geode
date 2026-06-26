/** How a tool's actions are executed server-side (the caller never sees the difference). */
export type Executor = "http" | "cli" | "mcp";

/** A named, credentialed instance of a tool (e.g. gmail "companyB"), with health for the caller. */
export interface Connection { label: string; status: "connected" | "needs_reconnect"; description?: string }

/** One callable action of a tool, with its parameters. */
export interface ToolAction { description: string; params: { name: string; required: boolean }[] }

/** A vault tool: one manifest, one or more connections, one `invoke` door regardless of executor. */
export interface ToolManifest {
  id: string;
  name: string;
  type: Executor;
  description: string;
  connections?: Connection[];
  actions: Record<string, ToolAction>;
}

/** Names of the candidate MCP tools the harness can register. */
export type ToolName = "list_capabilities" | "search" | "read" | "query" | "remember" | "invoke";

/** One tool call the caller made, with the text result it received back. */
export interface ToolCall { name: string; args: Record<string, unknown>; result: string }
/** Ordered record of every tool call in one caller conversation. */
export type Trace = ToolCall[];

/** A tool-surface variant under test. */
export interface EvalConfig {
  name: string;
  tools: ToolName[];
  descriptions: Record<string, string>;
  serverInstructions: string;
  listMode: "flat" | "tiered";
}

/** Whether the vault SHOULD or should NOT be reached for in a scenario. */
export type ScenarioClass = "should-use" | "should-not-use";

/** What correct caller behavior looks like for one leg. */
export interface Expect {
  discovers?: boolean;
  readsFile?: string;
  invokes?: { tool: string; action: string; connection?: string };
  remembers?: boolean;
}

/** One user turn within a scenario (most scenarios have one leg; store→retrieve has two). */
export interface ScenarioLeg { prompt: string; expect: Expect }
/** A scenario: an ordered set of legs sharing one vault copy. */
export interface Scenario { id: string; cls: ScenarioClass; legs: ScenarioLeg[] }

/** The caller's output for one leg. */
export interface LegResult { trace: Trace; finalText: string }

/** Per-leg score. `null` = not applicable to this leg/class. */
export interface LegMetrics {
  discovered: boolean | null;
  correctRetrieval: boolean | null;
  correctInvoke: boolean | null;
  falseTrigger: boolean | null;
  remembered: boolean | null;
  heavyQueryCalls: number;
}

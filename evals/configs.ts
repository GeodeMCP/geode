import type { EvalConfig } from "./types.js";

const NUDGE =
  "This user has a Geode vault — their own context, SOPs, integrations, and credentials, shared across all their AI assistants. " +
  "Before answering about THEIR projects, preferences, decisions, or 'how we/I usually…', and before any task that may need their tools or credentials, " +
  "call list_capabilities to orient, then search/read what's relevant — it's cheap. To act on a tool, call invoke (the server injects the right connection's secret). " +
  "Save durable learnings with remember. Don't reach into the vault for generic questions unrelated to this user.";

const RICH = {
  list_capabilities: "Map of the user's vault: their context index + every tool with its connections (accounts) and status. Zero-arg and cheap; call it first when a task might touch the user's own context or tools. Pass {tool} to see one tool's actions + params.",
  search: "Search the user's vault for THEIR context — projects, preferences, decisions, SOPs, tone — and read the raw matches yourself before answering. Cheap; prefer it over guessing.",
  read: "Read one vault file by path (from list_capabilities/search results).",
  invoke: "Run one action of a vault tool (the server injects the chosen connection's credentials and executes it). Pick the connection by intent, e.g. the user's company-B account.",
  remember: "Save a distilled, durable learning to the user's vault so their other assistants get it too. Give the essence, not a transcript.",
  query: "LAST RESORT: ask the vault's internal agent to synthesize across many files. Expensive — prefer search/read for direct lookups.",
};

const JARGON = {
  list_capabilities: "List what your Geode vault offers — recipes/skills and integrations with their actions.",
  query: "Ask your Geode vault — it searches your context and returns a synthesized answer, or an executable plan.",
  remember: "Save a distilled learning, fact, or note in your Geode vault.",
  invoke: "Run one action of an integration in your Geode vault.",
};

// leading's nudge plus an explicit "read the located file" step — tests whether weak models lift
// retrieval-recall when told to read the specific file instead of answering from the map/snippet.
const NUDGE_READ =
  NUDGE +
  " After list_capabilities or search points you at a relevant file, READ that specific file in full before answering — don't rely on the map or a snippet alone.";

const ALL = ["list_capabilities", "search", "read", "invoke", "remember", "query"] as const;

/** All tool-surface variants the harness pits against each other. */
export const CONFIGS: EvalConfig[] = [
  { name: "leading", tools: [...ALL], descriptions: RICH, serverInstructions: NUDGE, listMode: "tiered" },
  { name: "B-query-only", tools: ["list_capabilities", "query", "remember", "invoke"], descriptions: JARGON, serverInstructions: "", listMode: "flat" },
  { name: "C-search-only", tools: ["list_capabilities", "search", "invoke", "remember", "query"], descriptions: RICH, serverInstructions: NUDGE, listMode: "tiered" },
  { name: "D-flat-list", tools: [...ALL], descriptions: RICH, serverInstructions: NUDGE, listMode: "flat" },
  { name: "E-minimal-desc", tools: [...ALL], descriptions: { list_capabilities: "list", search: "search", read: "read", invoke: "invoke", remember: "remember", query: "query" }, serverInstructions: NUDGE, listMode: "tiered" },
  // F: leading + an explicit "read the located file" instruction — does it lift weak-model retrieval?
  { name: "F-read-nudge", tools: [...ALL], descriptions: RICH, serverInstructions: NUDGE_READ, listMode: "tiered" },
  // G: leading surface but EMPTY server instructions — isolates the nudge's effect on weak-model discovery.
  { name: "G-leading-no-instr", tools: [...ALL], descriptions: RICH, serverInstructions: "", listMode: "tiered" },
];

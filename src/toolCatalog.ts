export interface ToolParam { name: string; type: string; required: boolean }
export interface ToolDoc { name: string; description: string; params: ToolParam[] }

// Single source of truth for the MCP tool surface. `server.ts` registers each tool with the
// description here (so the dashboard copy and the MCP description are the same string), and the
// dashboard reads the whole catalog via GET /api/connect.
export const TOOL_CATALOG: ToolDoc[] = [
  {
    name: "query",
    description:
      "Ask your Geode vault — it searches your context, recipes and SOPs and returns a synthesized answer, OR an executable plan (the exact `invoke` calls to run). It prepares; you execute via `invoke`.",
    params: [{ name: "instruction", type: "string", required: true }],
  },
  {
    name: "remember",
    description:
      "Save a distilled learning, fact, or note in your Geode vault. Give the essence — not a whole conversation; the vault agent integrates, dedups, and files it.",
    params: [
      { name: "content", type: "string", required: true },
      { name: "source", type: "string", required: false },
      { name: "title", type: "string", required: false },
    ],
  },
  {
    name: "list_capabilities",
    description:
      "List what your Geode vault offers — recipes/skills and integrations with their actions. Cheap; call this to learn what the vault can do before delegating.",
    params: [],
  },
  {
    name: "invoke",
    description:
      "Run one action of an integration in your Geode vault — you (the caller) execute it; the server injects the required secret. First ask `query` for the plan (or read the integration manifest) to learn the action + params.",
    params: [
      { name: "integration", type: "string", required: true },
      { name: "action", type: "string", required: true },
      { name: "params", type: "object", required: false },
    ],
  },
];

export const toolDescription = (name: string): string => {
  const t = TOOL_CATALOG.find((d) => d.name === name);
  if (!t) throw new Error(`tool not in catalog: ${name}`);
  return t.description;
};

import { buildGraph, writeGraph, type VaultGraph } from "./graph.js";
import { writeIndex } from "./indexRender.js";
import type { SecretStore } from "./secrets.js";

/**
 * Rebuilds the vault's derived artifacts from its content: compiles the capability graph,
 * writes `.geode/graph.json`, and regenerates `index.md`. Deterministic — the files only
 * change (and thus only produce a git diff) when vault content changed. Returns the compiled
 * graph so callers can report on it.
 */
export async function regenerateArtifacts(root: string, secrets: Pick<SecretStore, "get">): Promise<VaultGraph> {
  const graph = await buildGraph(root, secrets);
  await writeGraph(root, graph);
  await writeIndex(root, graph);
  return graph;
}

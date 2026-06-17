import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function listCapabilities(root: string): Promise<string> {
  try {
    return await readFile(join(root, "capabilities.md"), "utf8");
  } catch {
    return "No capabilities manifest yet — add context with `remember` or run a task with `delegate` to populate it.";
  }
}

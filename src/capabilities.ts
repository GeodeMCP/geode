import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function listCapabilities(root: string): Promise<string> {
  try {
    return await readFile(join(root, "capabilities.md"), "utf8");
  } catch (err) {
    // Only treat "not there yet" as the friendly empty case; surface real errors (e.g. EACCES).
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "No capabilities manifest yet — add context with `remember` or run a task with `delegate` to populate it.";
    }
    throw err;
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

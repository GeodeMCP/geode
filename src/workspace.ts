import { runGit } from "./git.js";

export interface Workspace {
  root: string;
  init(): Promise<void>;
  isClean(): Promise<boolean>;
  head(): Promise<string>;
  commitAll(message: string): Promise<string | null>;
  resetToHead(): Promise<void>;
  changedFilesSince(ref: string): Promise<string[]>;
}

export function createWorkspace(root: string): Workspace {
  return {
    root,
    async init() {
      let isRepo = true;
      try { await runGit(root, ["rev-parse", "--is-inside-work-tree"]); } catch { isRepo = false; }
      if (!isRepo) await runGit(root, ["init"]);
      await runGit(root, ["config", "user.email", "kernel@geode.local"]);
      await runGit(root, ["config", "user.name", "Geode Kernel"]);
      try { await runGit(root, ["rev-parse", "HEAD"]); }
      catch { await runGit(root, ["commit", "--allow-empty", "-m", "chore: initialize vault"]); }
    },
    async isClean() {
      return (await runGit(root, ["status", "--porcelain"])) === "";
    },
    async head() {
      return runGit(root, ["rev-parse", "HEAD"]);
    },
    async commitAll(message) {
      await runGit(root, ["add", "-A"]);
      if ((await runGit(root, ["status", "--porcelain"])) === "") return null;
      await runGit(root, ["commit", "-m", message]);
      return runGit(root, ["rev-parse", "HEAD"]);
    },
    async resetToHead() {
      await runGit(root, ["reset", "--hard", "HEAD"]);
      await runGit(root, ["clean", "-fd"]);
    },
    async changedFilesSince(ref) {
      const out = await runGit(root, ["diff", "--name-only", ref, "HEAD"]);
      return out ? out.split("\n") : [];
    },
  };
}

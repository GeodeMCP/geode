import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { runGit } from "./git.js";

export interface Workspace {
  root: string;
  init(): Promise<void>;
  isClean(): Promise<boolean>;
  head(): Promise<string>;
  commitAll(message: string): Promise<string | null>;
  resetToHead(): Promise<void>;
  changedFilesSince(ref: string): Promise<string[]>;
  uncommittedChanges(): Promise<string[]>;
  fileContent(relPath: string): Promise<string>;
  diff(relPath: string): Promise<string>;
  statusPorcelain(): Promise<string>;
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
    async uncommittedChanges() {
      const out = await runGit(root, ["status", "--porcelain"]);
      if (!out) return [];
      // porcelain line: "XY PATH" where XY is always 2 chars.
      // runGit trims stdout so the leading space of the very first line may be
      // stripped (e.g. " M file" → "M file"). Parse robustly: the path follows
      // the 2-char status block + 1 separator space; normalise by left-padding
      // each line to at least 3 chars before slicing.
      return out.split("\n").map((l) => {
        const norm = l.length < 3 || l[2] !== " " ? " " + l : l;
        const p = norm.slice(3);
        const arrow = p.indexOf(" -> ");
        return arrow >= 0 ? p.slice(arrow + 4) : p;
      });
    },
    async fileContent(relPath) {
      const abs = resolve(root, relPath);
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path outside workspace: ${relPath}`);
      return readFile(abs, "utf8");
    },
    async diff(relPath) {
      const abs = resolve(root, relPath);
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path outside workspace: ${relPath}`);
      return runGit(root, ["diff", "HEAD", "--", relPath]);
    },
    async statusPorcelain() {
      return runGit(root, ["status", "--porcelain"]);
    },
  };
}

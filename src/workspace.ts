import { readFile, realpath, writeFile as fsWriteFile, mkdir, lstat, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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
  writeFile(relPath: string, content: string): Promise<void>;
  deletePath(relPath: string): Promise<void>;
}

export function createWorkspace(root: string): Workspace {
  const HIDDEN_FIRST = new Set([".git", "integrations", "artifacts", "node_modules"]);
  // Resolve a vault-relative path safely: reject traversal + machinery dirs, and
  // follow symlinks (realpath) so a symlink inside the vault can't point outside it.
  const safeResolve = async (relPath: string): Promise<string> => {
    const cleaned = relPath.replace(/^\/+/, "");
    const first = cleaned.split("/")[0];
    if (!cleaned) throw new Error(`path not allowed: ${relPath}`);
    if (first === "..") throw new Error(`path outside workspace: ${relPath}`);
    if (HIDDEN_FIRST.has(first)) throw new Error(`path not allowed: ${relPath}`);
    const lexical = resolve(root, cleaned);
    if (lexical !== root && !lexical.startsWith(root + sep)) throw new Error(`path outside workspace: ${relPath}`);
    const rootReal = await realpath(root);
    let probe = lexical;
    for (;;) {
      try {
        const real = await realpath(probe);
        if (real !== rootReal && !real.startsWith(rootReal + sep)) throw new Error(`path outside workspace: ${relPath}`);
        break;
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          if (probe === lexical) {
            try { if ((await lstat(lexical)).isSymbolicLink()) throw new Error(`path outside workspace: ${relPath}`); }
            catch (le: any) { if (le?.code !== "ENOENT") throw le; }
          }
          const parent = dirname(probe); if (parent === probe || parent.length < root.length) break; probe = parent; continue;
        }
        throw e;
      }
    }
    return lexical;
  };

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
      const out = await runGit(root, ["status", "--porcelain", "-uall"]);
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
      return readFile(await safeResolve(relPath), "utf8");
    },
    async diff(relPath) {
      await safeResolve(relPath);
      const tracked = await runGit(root, ["diff", "HEAD", "--", relPath]);
      if (tracked) return tracked;
      // untracked/new file: git diff HEAD shows nothing → diff against /dev/null
      // (git exits 1 when files differ, so capture stdout from the rejected exec).
      try { return await runGit(root, ["diff", "--no-index", "--", "/dev/null", relPath]); }
      catch (e: any) { return typeof e?.stdout === "string" ? e.stdout.trimEnd() : ""; }
    },
    async statusPorcelain() {
      return runGit(root, ["status", "--porcelain", "-uall"]);
    },
    async writeFile(relPath, content) {
      const abs = await safeResolve(relPath);
      await mkdir(dirname(abs), { recursive: true });
      await fsWriteFile(abs, content, "utf8");
    },
    async deletePath(relPath) {
      // path-safe + knowledge-only via safeResolve; removes a file or a folder (recursive).
      await rm(await safeResolve(relPath), { recursive: true, force: true });
    },
  };
}

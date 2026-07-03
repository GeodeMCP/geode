import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { dirname, resolve, sep, join, relative } from "node:path";
import AdmZip from "adm-zip";

/** One uploaded file: its path relative to the upload root, and its raw bytes. */
export interface UploadFile { relPath: string; buffer: Buffer }

/** Stages uploaded files under `baseDir`, expanding any `.zip` into its entries; returns the relative paths written. Throws on any path that would escape `baseDir`. */
export async function stageFiles(baseDir: string, files: UploadFile[]): Promise<string[]> {
  const root = resolve(baseDir);
  const written: string[] = [];
  const safeAbs = (rel: string): string => {
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`unsafe upload path: ${rel}`);
    return abs;
  };
  const put = async (rel: string, buf: Buffer) => {
    const abs = safeAbs(rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    written.push(rel);
  };
  for (const f of files) {
    if (f.relPath.toLowerCase().endsWith(".zip")) {
      for (const e of new AdmZip(f.buffer).getEntries()) {
        if (!e.isDirectory) await put(e.entryName, e.getData());
      }
    } else {
      await put(f.relPath, f.buffer);
    }
  }
  return written;
}

/** A persistent per-conversation attachment folder: uploaded files accumulate here across turns until cleared. */
export interface AttachmentStore {
  /** The folder holding the current conversation's attachments (granted read-only to agent runs). */
  dir: string;
  /** Stages more files into the folder; returns the relative paths written. */
  add(files: UploadFile[]): Promise<string[]>;
  /** Lists the relative paths currently in the folder. */
  list(): Promise<string[]>;
  /** Empties the folder. */
  clear(): Promise<void>;
}

/** Recursively lists file paths under `dir`, relative to `base`, using forward slashes; returns [] if the dir is absent. */
async function listFilesRec(dir: string, base: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFilesRec(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/** Creates an AttachmentStore rooted at `opts.dir` — a single persistent folder shared across a conversation's turns. */
export function createAttachmentStore(opts: { dir: string }): AttachmentStore {
  return {
    dir: opts.dir,
    add: (files) => stageFiles(opts.dir, files),
    list: () => listFilesRec(opts.dir, opts.dir),
    clear: async () => { await rm(opts.dir, { recursive: true, force: true }); },
  };
}


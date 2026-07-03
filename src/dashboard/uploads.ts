import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, resolve, sep, join } from "node:path";
import { randomUUID } from "node:crypto";
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

/** A staged-upload store: writes each upload into its own UUID temp dir and resolves/cleans them. */
export interface UploadStore {
  stage(files: UploadFile[]): Promise<{ uploadId: string; dir: string }>;
  resolve(uploadId: string): string;
  cleanup(uploadId: string): Promise<void>;
}

const UPLOAD_ID_RE = /^[0-9a-f-]{36}$/;

/** Creates an UploadStore rooted at `opts.dir`; each upload gets a fresh UUID subdirectory. */
export function createUploadStore(opts: { dir: string }): UploadStore {
  const dirFor = (id: string): string => {
    if (!UPLOAD_ID_RE.test(id)) throw new Error("invalid uploadId");
    return join(opts.dir, id);
  };
  return {
    async stage(files) {
      const uploadId = randomUUID();
      const dir = join(opts.dir, uploadId);
      await stageFiles(dir, files);
      return { uploadId, dir };
    },
    resolve(uploadId) { return dirFor(uploadId); },
    async cleanup(uploadId) { await rm(dirFor(uploadId), { recursive: true, force: true }); },
  };
}


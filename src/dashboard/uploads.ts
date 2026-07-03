import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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

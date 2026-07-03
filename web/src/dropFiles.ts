/** One picked or dropped file, with its folder-relative path preserved so the vault agent sees the structure. */
export interface Picked { file: File; relPath: string }

/** Maps a file-input FileList to Picked[], keeping the webkitdirectory relative path when present. */
export function pickedFromInput(list: FileList | null): Picked[] {
  return list ? Array.from(list).map((file) => ({ file, relPath: file.webkitRelativePath || file.name })) : [];
}

// Universal VCS/build/OS noise — never worth uploading when a folder is dropped.
const SKIP = new Set([".git", "node_modules", ".pytest_cache", "__pycache__", ".venv", ".DS_Store"]);

/** Recursively reads a filesystem entry into `out` (draining directory readers in ~100-entry batches), preserving relative paths and skipping noise dirs. */
function readAll(entry: FileSystemEntry, prefix: string, out: Picked[]): Promise<void> {
  return new Promise((resolve) => {
    if (SKIP.has(entry.name)) { resolve(); return; }
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => { out.push({ file, relPath: prefix + entry.name }); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const step = () => reader.readEntries((batch) => {
        if (!batch.length) { resolve(); return; }
        void Promise.all(batch.map((e) => readAll(e, `${prefix + entry.name}/`, out))).then(step);
      }, () => resolve());
      step();
    } else resolve();
  });
}

/** Reads a drop's DataTransfer, recursing into any dropped folders, returning files with folder-relative paths. */
export async function readDropped(dt: DataTransfer): Promise<Picked[]> {
  // webkitGetAsEntry MUST be called synchronously while the drop event is live, before any await.
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (!entries.length) return Array.from(dt.files).map((file) => ({ file, relPath: file.name }));
  const out: Picked[] = [];
  await Promise.all(entries.map((e) => readAll(e, "", out)));
  return out;
}

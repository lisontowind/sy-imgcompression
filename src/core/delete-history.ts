import { fileExists, KernelError } from "../api";
import { AssetJob, DirectoryEntry, Kernel, UserError } from "../types";
import { BACKUP_ROOT } from "./compress-files";
import { assetDiskPath, extensionOf } from "./paths";

/** Only generated, job-owned backup filenames are eligible. Never use asset paths. */
export function historyBackupPaths(job: AssetJob): string[] {
  const result: string[] = [];
  for (const [index, item] of job.items.entries()) {
    if (item.operation !== "replace-file") {
      if (item.backupDiskPath) throw new UserError("unsafeBackup");
      continue;
    }
    const extension = extensionOf(item.oldPath);
    if (job.kind !== "compress" || !/^\d{14}-[a-z0-9]{7}$/.test(job.id) || !/^\.(?:png|jpe?g|webp)$/i.test(extension)
        || assetDiskPath(item.oldDiskPath, item.oldPath) !== item.oldDiskPath
        || item.newPath !== item.oldPath || item.newDiskPath !== item.oldDiskPath) throw new UserError("unsafeBackup");
    const expected = `${BACKUP_ROOT}${job.id}-${index}${extension}`;
    if (item.backupDiskPath && item.backupDiskPath !== expected) throw new UserError("unsafeBackup");
    // A crash before the preparation checkpoint can leave a backup without its
    // path in the log. Its generated name is still determined by the saved job.
    result.push(expected);
  }
  return result;
}

/** Inspect only the plugin's backup directory, never workspace references/assets. */
export async function planHistoryDeletion(kernel: Kernel, jobs: AssetJob[], retained: AssetJob[]): Promise<string[]> {
  const paths = [...new Set(jobs.flatMap(historyBackupPaths))];
  const referenced = new Set(retained.flatMap(job => job.items.map(item => item.backupDiskPath).filter(Boolean)));
  if (paths.some(path => referenced.has(path))) throw new UserError("unsafeBackup");
  if (!paths.length) return [];
  let entries: DirectoryEntry[];
  try { entries = await kernel.post<DirectoryEntry[]>("/api/file/readDir", { path: BACKUP_ROOT.slice(0, -1) }); }
  catch (error) { if (error instanceof KernelError && error.code === 404) return []; throw error; }
  if (!Array.isArray(entries)) throw new UserError("readFailed", BACKUP_ROOT);
  const names = new Map(entries.map(entry => [entry.name, entry]));
  return paths.filter(path => {
    const entry = names.get(path.slice(BACKUP_ROOT.length));
    if (!entry) return false;
    if (entry.isDir !== false || entry.isSymlink) throw new UserError("unsafeBackup", path);
    return true;
  });
}

export async function deleteBackup(kernel: Kernel, path: string): Promise<void> {
  if (!path.startsWith(BACKUP_ROOT) || !/^\d{14}-[a-z0-9]{7}-\d+\.(?:png|jpe?g|webp)$/i.test(path.slice(BACKUP_ROOT.length))) throw new UserError("unsafeBackup");
  try { await kernel.post("/api/file/removeFile", { path }); }
  catch (error) {
    if (error instanceof KernelError && error.code === 404) return;
    // A lost response is not a reason to resend a deletion. Verify its outcome.
    if (error instanceof KernelError && error.outcomeUnknown && !await fileExists(kernel, path)) return;
    throw error;
  }
  if (await fileExists(kernel, path)) throw new UserError("deleteBackupFailed", path);
}

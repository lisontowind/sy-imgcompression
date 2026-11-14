import { describe, expect, it, vi } from "vitest";
import { KernelError } from "../src/api";
import { BACKUP_ROOT } from "../src/core/compress-files";
import { DEFAULT_COMPRESSION, JobManager } from "../src/core/jobs";
import { AssetJob, DirectoryEntry, Journal, Kernel } from "../src/types";
import { png } from "./fixtures";

function job(number: number): AssetJob {
  const path = `assets/${number}.png`, id = `20261114000100-job${String(number).padStart(4, "0")}`;
  return { schema: 1, id, kind: "compress", created: "2026-11-14T00:00:00.000Z", documentId: "doc", documentTitle: `Task ${number}`,
    state: "completed", options: DEFAULT_COMPRESSION, items: [{ operation: "replace-file", oldPath: path, newPath: path,
      oldDiskPath: "/data/" + path, newDiskPath: "/data/" + path, backupDiskPath: `${BACKUP_ROOT}${id}-0.png`,
      before: [], plannedAfter: [], state: "completed", originalSize: 100 }] };
}
function setup() {
  const jobs = [job(1), job(2)], files = new Map<string, ArrayBuffer>();
  for (const job of jobs) { files.set(job.items[0].oldDiskPath, png()); files.set(job.items[0].backupDiskPath!, png(8, 8)); }
  let saved: Journal = { jobs: structuredClone(jobs) };
  let missingDirectory = false;
  const extraEntries: DirectoryEntry[] = [];
  const post = vi.fn(async (endpoint: string, body: any) => {
    if (endpoint.endsWith("readDir")) {
      expect(body.path).toBe(BACKUP_ROOT.slice(0, -1));
      if (missingDirectory) throw new KernelError(endpoint, undefined, "path does not exist", false, 404);
      return [...files.keys()].filter(path => path.startsWith(BACKUP_ROOT)).map(path => ({ name: path.slice(BACKUP_ROOT.length), isDir: false, updated: 0 })).concat(extraEntries);
    }
    if (endpoint.endsWith("removeFile")) { files.delete(body.path); return null; }
    throw new Error("Unexpected workspace request: " + endpoint);
  });
  const kernel = { post, fileExists: async (path: string) => files.has(path),
    readFile: async (path: string) => { const bytes = files.get(path); if (!bytes) throw new Error("missing"); return bytes.slice(0); },
    putFile: vi.fn(),
  } as Kernel;
  const save = vi.fn(async (journal: Journal) => { saved = structuredClone(journal); });
  const store = { load: async () => saved, save };
  const manager = new JobManager(kernel, store);
  return { jobs, files, extraEntries, kernel, post, save, store, manager, saved: () => saved, missingDirectory: () => { missingDirectory = true; } };
}

describe("deleting plugin history and backups", () => {
  it("deletes only the selected job's own backup and preserves current images and other jobs", async () => {
    const { jobs, files, manager, saved, post } = setup();
    await manager.deleteHistory([jobs[0].id]);
    expect(saved().jobs.map(job => job.id)).toEqual([jobs[1].id]);
    expect(files.has(jobs[0].items[0].backupDiskPath!)).toBe(false);
    expect(files.has(jobs[1].items[0].backupDiskPath!)).toBe(true);
    for (const job of jobs) expect(files.get(job.items[0].oldDiskPath)).toEqual(png());
    expect(post.mock.calls.every(([endpoint]) => /\/api\/file\/(readDir|removeFile)$/.test(endpoint))).toBe(true);
  });
  it("allows clearing legacy records even when original attachments have already been cleaned", async () => {
    const { jobs, manager, saved, post, files } = setup();
    for (const job of saved().jobs) { delete job.items[0].operation; delete job.items[0].backupDiskPath; job.kind = "rename"; }
    files.clear(); files.set("/data/assets/current.webp", png());
    await manager.deleteHistory(jobs.map(job => job.id));
    expect(saved().jobs).toEqual([]); expect(post).not.toHaveBeenCalled();
    expect(files.size).toBe(1); expect(files.has("/data/assets/current.webp")).toBe(true);
  });
  it("can clear records when all plugin backups or the entire backup directory are missing", async () => {
    const { jobs, manager, saved, missingDirectory } = setup(); missingDirectory();
    await manager.deleteHistory(jobs.map(job => job.id)); expect(saved().jobs).toEqual([]);
  });
  it("finds a job's generated backup after a crash before its path was checkpointed", async () => {
    const { jobs, manager, saved, files } = setup();
    delete saved().jobs[0].items[0].backupDiskPath; saved().jobs[0].state = "interrupted";
    await manager.deleteHistory([jobs[0].id]); expect(files.has(jobs[0].items[0].backupDiskPath!)).toBe(false);
  });
  it.each(["/data/assets/1.png", BACKUP_ROOT, BACKUP_ROOT + "../jobs.json", BACKUP_ROOT + "20261114000100-job0002-0.png"])("rejects unowned backup path %s before any mutation", async path => {
    const { jobs, manager, saved, post, save } = setup(); saved().jobs[0].items[0].backupDiskPath = path;
    await expect(manager.deleteHistory([jobs[0].id])).rejects.toThrow("unsafeBackup");
    expect(post).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it.each(["directory", "symlink"])("does not remove a %s at a generated backup name", async type => {
    const { jobs, manager, extraEntries, post, save } = setup();
    extraEntries.push({ name: jobs[0].items[0].backupDiskPath!.slice(BACKUP_ROOT.length), isDir: type === "directory", isSymlink: type === "symlink", updated: 0 });
    await expect(manager.deleteHistory([jobs[0].id])).rejects.toThrow("unsafeBackup");
    expect(post.mock.calls.filter(([endpoint]) => endpoint.endsWith("removeFile"))).toHaveLength(0); expect(save).not.toHaveBeenCalled();
  });
  it("retains records after a partial failure and permits explicit cleanup after restarting", async () => {
    const { jobs, manager, kernel, store, saved, files, post } = setup(); const original = kernel.post; let fail = true;
    kernel.post = async (endpoint, body: any) => {
      if (endpoint.endsWith("removeFile") && body.path === jobs[1].items[0].backupDiskPath && fail) { fail = false; throw new Error("permission denied"); }
      return original(endpoint, body) as any;
    };
    await expect(manager.deleteHistory(jobs.map(job => job.id))).rejects.toThrow("permission denied");
    expect(saved().jobs).toHaveLength(2); expect(saved().jobs.every(job => job.deleting)).toBe(true);
    await expect(manager.restore(jobs[0])).rejects.toThrow("historyDeleting");
    const next = new JobManager(kernel, store); await next.initialize();
    await next.deleteHistory(jobs.map(job => job.id));
    expect(saved().jobs).toEqual([]); expect(files.size).toBe(2);
    expect(post.mock.calls.filter(([endpoint, body]) => endpoint.endsWith("removeFile") && body.path === jobs[0].items[0].backupDiskPath)).toHaveLength(1);
  });
  it("verifies a lost deletion response without sending the mutation twice", async () => {
    const { jobs, manager, kernel, files, saved } = setup(); const original = kernel.post; let removes = 0;
    kernel.post = async (endpoint, body: any) => {
      if (endpoint.endsWith("removeFile")) { removes++; files.delete(body.path); throw new KernelError(endpoint, undefined, "connection lost", true); }
      return original(endpoint, body) as any;
    };
    await manager.deleteHistory([jobs[0].id]); expect(removes).toBe(1); expect(saved().jobs).toHaveLength(1);
  });
  it("treats an explicit missing-file result as an already deleted backup", async () => {
    const { jobs, manager, kernel, saved } = setup(); const original = kernel.post;
    kernel.post = async (endpoint, body: any) => {
      if (endpoint.endsWith("removeFile")) throw new KernelError(endpoint, undefined, "missing", false, 404);
      return original(endpoint, body) as any;
    };
    await manager.deleteHistory([jobs[0].id]); expect(saved().jobs).toHaveLength(1);
  });
  it("retains records when a success response still leaves the backup present", async () => {
    const { jobs, manager, kernel, saved } = setup(); const original = kernel.post;
    kernel.post = async (endpoint, body) => endpoint.endsWith("removeFile") ? null as any : original(endpoint, body) as any;
    await expect(manager.deleteHistory([jobs[0].id])).rejects.toThrow("deleteBackupFailed");
    expect(saved().jobs).toHaveLength(2); expect(saved().jobs[0].deleting).toBe(true);
  });
  it("does not delete files if persisting the cleanup marker fails", async () => {
    const { jobs, manager, save, files, post } = setup(); save.mockRejectedValueOnce(new Error("storage full"));
    await expect(manager.deleteHistory([jobs[0].id])).rejects.toThrow("storage full");
    expect(files.size).toBe(4); expect(post.mock.calls.some(([endpoint]) => endpoint.endsWith("removeFile"))).toBe(false);
  });
  it("retains retryable records when the final journal save fails after file deletion", async () => {
    const { jobs, manager, save, saved, files } = setup();
    save.mockImplementationOnce(async value => { Object.assign(saved(), structuredClone(value)); }).mockRejectedValueOnce(new Error("storage full"));
    await expect(manager.deleteHistory([jobs[0].id])).rejects.toThrow("storage full");
    expect(manager.journal.jobs).toHaveLength(2); expect(saved().jobs[0].deleting).toBe(true);
    expect(files.has(jobs[0].items[0].backupDiskPath!)).toBe(false);
    await manager.deleteHistory([jobs[0].id]); expect(saved().jobs.map(job => job.id)).toEqual([jobs[1].id]);
  });
  it("reloads the latest journal under the existing lock and keeps a newly created task", async () => {
    const { jobs, manager, saved } = setup(); await manager.initialize();
    const newer = job(3); saved().jobs.unshift(newer);
    await manager.deleteHistory(jobs.map(job => job.id)); expect(saved().jobs.map(job => job.id)).toEqual([newer.id]);
  });
});

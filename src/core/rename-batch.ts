import { AssetIdentity, AssetJob, DirectoryEntry, Kernel } from "../types";
import { basename } from "./paths";
import { applyBatch, BatchContext } from "./batch-operations";

export async function renameBatch(kernel: Kernel, job: AssetJob, assets: AssetIdentity[], context: BatchContext): Promise<boolean> {
  const entries = await kernel.post<DirectoryEntry[]>("/api/file/readDir", { path: "/data/assets" }, context.signal);
  const existing = new Set(entries.map(entry => entry.name.toLowerCase())), counts = new Map<string, number>();
  for (const item of job.items) counts.set(item.newPath.toLowerCase(), (counts.get(item.newPath.toLowerCase()) || 0) + 1);
  const conflicts = new Set(job.items.filter(item => existing.has(basename(item.newPath).toLowerCase()) || counts.get(item.newPath.toLowerCase()) !== 1));
  const byPath = new Map(assets.map(asset => [asset.path, asset]));
  const candidates = job.items.filter(item => !conflicts.has(item) && byPath.get(item.oldPath)!.size <= 256 * 1024 * 1024);
  const eligible = new Set(candidates);
  for (const item of job.items) if (!eligible.has(item)) { item.state = "skipped"; item.error = conflicts.has(item) ? "filenameConflict" : "attachmentTooLarge"; }
  context.progress({ done: 0, total: assets.length, path: "", stage: "preparing" });
  return applyBatch(kernel, job, byPath, candidates, context);
}
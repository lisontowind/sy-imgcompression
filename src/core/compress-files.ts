import { fileExists } from "../api";
import { inspectImage } from "../compression/image-info";
import { AssetIdentity, AssetJob, CompressionOptions, CompressionResult, JobItem, Kernel, Progress, UserError } from "../types";
import { assetDiskPath } from "./paths";
import { digest } from "./references";
import { checkCancelled } from "./cancellation";

export const BACKUP_ROOT = "/data/storage/petal/sy-imgcompression/backups/";
const BATCH_FILES = 128, BATCH_OUTPUT_BYTES = 32 * 1024 * 1024;
const skippable = new Set(["imageTooLarge", "attachmentTooLarge", "animatedImage", "unsupportedImage", "damagedImage", "compressionTimeout"]);

/** Restore only the bytes this job wrote; references are never read or changed. */
export async function restoreFile(kernel: Kernel, item: JobItem, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  if (item.operation !== "replace-file" || !item.sourceDigest || !item.targetDigest || !item.backupDiskPath
      || !/^\d{14}-[a-z0-9]{7}-\d+\.(?:png|jpe?g|webp)$/i.test(item.backupDiskPath.slice(BACKUP_ROOT.length))
      || !item.backupDiskPath.startsWith(BACKUP_ROOT) || item.oldPath !== item.newPath || item.oldDiskPath !== item.newDiskPath
      || assetDiskPath(item.oldDiskPath, item.oldPath) !== item.oldDiskPath) throw new UserError("restoreConflict");
  const backup = await kernel.readFile(item.backupDiskPath, signal);
  if (await digest(backup) !== item.sourceDigest) throw new UserError("restoreConflict");
  const current = await digest(await kernel.readFile(item.oldDiskPath, signal));
  if (current === item.sourceDigest) { item.state = "restored"; return; }
  if (current !== item.targetDigest) throw new UserError("restoreConflict");
  checkCancelled(signal);
  // Once a write starts, finish verification even if cancellation arrives.
  await kernel.putFile(item.oldDiskPath, backup);
  if (await digest(await kernel.readFile(item.oldDiskPath)) !== item.sourceDigest) throw new UserError("writeVerificationFailed");
  item.state = "restored";
}

/** Stream sources/backups; bound encoded outputs while sharing journal checkpoints. */
export async function compressFiles(kernel: Kernel, job: AssetJob, assets: AssetIdentity[], context: {
  readSource(asset: AssetIdentity): Promise<ArrayBuffer>;
  encode(source: ArrayBuffer, options: CompressionOptions): Promise<CompressionResult>;
  save(): Promise<void>; checkCancelled(): void; progress(progress: Progress): void; signal?: AbortSignal;
}): Promise<void> {
  let pending: { asset: AssetIdentity; item: JobItem; bytes: ArrayBuffer }[] = [], outputBytes = 0;
  const progress = (item: JobItem, stage: string) => context.progress({
    done: job.items.filter(item => ["completed", "skipped"].includes(item.state)).length,
    total: assets.length, path: item.oldPath, stage,
  });
  const flush = async () => {
    if (!pending.length) return;
    context.checkCancelled();
    for (const { item } of pending) item.state = "applying";
    // Persist every backup and planned hash before the first overwrite. A crash
    // can leave some originals untouched; restoreFile recognises those hashes.
    await context.save();
    for (const { asset, item, bytes } of pending) {
      let writing = false;
      try {
        context.checkCancelled();
        if (await digest(await kernel.readFile(item.backupDiskPath!, context.signal)) !== item.sourceDigest) throw new UserError("writeVerificationFailed");
        if (await digest(await kernel.readFile(asset.diskPath, context.signal)) !== item.sourceDigest) throw new UserError("sourceChanged", asset.path);
        progress(item, "writingImage"); context.checkCancelled();
        writing = true; await kernel.putFile(asset.diskPath, bytes);
        progress(item, "verifyingImage");
        if (await digest(await kernel.readFile(asset.diskPath)) !== item.targetDigest) throw new UserError("writeVerificationFailed");
        context.checkCancelled(); item.state = "completed";
      } catch (error) {
        for (const entry of pending) if (entry.item.state === "applying") entry.item.state = "prepared";
        item.error = error instanceof UserError ? error.code : String(error);
        item.state = writing ? "recovery-required" : "failed"; await context.save();
        if (writing) {
          try { await restoreFile(kernel, item); }
          catch (recoveryError) { item.error += "; " + String(recoveryError); }
        }
        await context.save(); throw error;
      }
    }
    pending = []; outputBytes = 0; await context.save();
  };
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index], item = job.items[index];
    context.checkCancelled(); progress(item, "preparing");
    try {
      if (assetDiskPath(asset.diskPath, asset.path) !== asset.diskPath) throw new UserError("invalidAssetPath");
      const source = await context.readSource(asset), info = inspectImage(source);
      item.sourceDigest = await digest(source); context.checkCancelled();
      if (asset.previewDigest && item.sourceDigest !== asset.previewDigest) throw new UserError("sourceChanged", asset.path);
      const result = await context.encode(source.slice(0), item.compressionOptions!);
      context.checkCancelled(); item.resultSize = result.bytes.byteLength;
      if (result.bytes.byteLength >= source.byteLength) { item.state = "skipped"; item.error = "noSavings"; continue; }
      if (inspectImage(result.bytes).format !== info.format || result.mime !== info.mime) throw new UserError("writeVerificationFailed");
      item.targetDigest = await digest(result.bytes);
      item.backupDiskPath = `${BACKUP_ROOT}${job.id}-${index}${asset.extension}`;
      progress(item, "backingUp");
      if (await fileExists(kernel, item.backupDiskPath)) throw new UserError("filenameConflict");
      context.checkCancelled();
      await kernel.putFile(item.backupDiskPath, source);
      context.checkCancelled();
      item.state = "prepared"; pending.push({ asset, item, bytes: result.bytes }); outputBytes += result.bytes.byteLength;
    } catch (error) {
      item.error = error instanceof UserError ? error.code : String(error);
      item.state = error instanceof UserError && skippable.has(error.code) ? "skipped" : "failed";
      if (item.state === "skipped") continue;
      await context.save(); throw error;
    }
    // The byte budget can include at most the image just encoded in addition.
    if (pending.length >= BATCH_FILES || outputBytes >= BATCH_OUTPUT_BYTES) await flush();
  }
  await flush();
}

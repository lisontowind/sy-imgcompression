import { AssetIdentity, AssetJob, CompressionResult, JobItem, Kernel, UserError } from "../types";
import { applyBatch, BatchContext } from "./batch-operations";
import { newNodeId } from "./naming";

export const BATCH_FILES = 128;
export const BATCH_OUTPUT_BYTES = 32 * 1024 * 1024;
export interface PreparedCompression { result: CompressionResult; sourceDigest: string }
const skippable = new Set(["imageTooLarge", "attachmentTooLarge", "animatedImage", "unsupportedImage", "damagedImage", "compressionTimeout"]);

export async function compressBatch(kernel: Kernel, job: AssetJob, assets: AssetIdentity[], context: BatchContext & {
  prepare(asset: AssetIdentity, item: JobItem): Promise<CompressionResult>;
}): Promise<{ handled: boolean; cached: Map<string, PreparedCompression> }> {
  const byPath = new Map(assets.map(asset => [asset.path, asset]));
  const cached = new Map<string, PreparedCompression>();
  let items: JobItem[] = [], bytes = 0, committed = false;
  const flush = async () => {
    if (!items.length) return true;
    const outputs = new Map([...cached].map(([path, value]) => [path, value.result.bytes]));
    if (!await applyBatch(kernel, job, byPath, items, context, outputs)) {
      if (committed) throw new UserError("unsupportedKernel");
      return false;
    }
    committed = true; items = []; bytes = 0; cached.clear(); return true;
  };
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index], item = job.items[index];
    context.checkCancelled();
    context.progress({ done: index, total: assets.length, path: asset.path, stage: "preparing" });
    try {
      const result = await context.prepare(asset, item);
      context.checkCancelled(); item.resultSize = result.bytes.byteLength;
      if (result.bytes.byteLength >= item.originalSize) { item.state = "skipped"; item.error = "noSavings"; continue; }
      item.newPath = `assets/image-${newNodeId()}${result.extension}`;
      cached.set(asset.path, { result, sourceDigest: item.sourceDigest! }); items.push(item); bytes += result.bytes.byteLength;
    } catch (error) {
      item.error = error instanceof UserError ? error.code : String(error);
      if (error instanceof UserError && skippable.has(error.code)) { item.state = "skipped"; continue; }
      item.state = "failed"; throw error;
    }
    // The output budget may be exceeded by at most the one image just encoded.
    if ((items.length >= BATCH_FILES || bytes >= BATCH_OUTPUT_BYTES) && !await flush()) return { handled: false, cached };
  }
  if (!await flush()) return { handled: false, cached };
  if (!committed) await context.save();
  return { handled: true, cached };
}

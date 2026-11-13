import { fileExists, KernelError } from "../api";
import { AssetIdentity, AssetJob, JobItem, Kernel, Progress, UserError } from "../types";
import { validateFilename } from "./naming";
import { basename } from "./paths";
import { digest, expectedAfter, findReferencesBatch, referenceFingerprint, relinkBatch } from "./references";

export interface BatchContext {
  save(): Promise<void>;
  checkCancelled(): void;
  restore(items: JobItem[]): Promise<void>;
  progress(progress: Progress): void;
  readSource(asset: AssetIdentity): Promise<ArrayBuffer>;
  signal?: AbortSignal;
}
export const visibleReferences = (refs: JobItem["before"]) => refs.filter(ref => !["annotation-file", "ocr"].includes(ref.type));
export const batchUnsupported = (error: unknown): boolean => error instanceof KernelError
  && /(?:\[?path\]? (?:is )?required|unknown (?:field|parameter).*paths|unexpected.*paths)/i.test(error.message);

/** Four fresh workspace requests, never sharing mutation or reference reports. */
export async function applyBatch(kernel: Kernel, job: AssetJob, assets: Map<string, AssetIdentity>, items: JobItem[], context: BatchContext, outputs?: Map<string, ArrayBuffer>): Promise<boolean> {
  if (!items.length) { await context.save(); return true; }
  context.checkCancelled();
  let baseline: Awaited<ReturnType<typeof findReferencesBatch>>;
  try { baseline = await findReferencesBatch(kernel, items.map(item => item.oldPath), context.signal); }
  catch (error) { if (batchUnsupported(error)) return false; throw error; }
  try {
    for (const item of items) {
      context.checkCancelled();
      const asset = assets.get(item.oldPath)!, refs = baseline.get(item.oldPath)!;
      if (!refs.length) throw new UserError("noReferences", item.oldPath);
      if (asset.referencesLoaded !== false && referenceFingerprint(refs) !== referenceFingerprint(asset.references)) throw new UserError("sourceChanged", item.oldPath);
      item.before = refs;
    }
    let copied = job.items.filter(item => ["completed", "skipped"].includes(item.state)).length;
    for (const item of items) {
      context.checkCancelled();
      context.progress({ done: copied, total: job.items.length, path: item.oldPath, stage: "preparing" });
      validateFilename(basename(item.newPath)); item.newDiskPath = "/data/" + item.newPath;
      const output = outputs?.get(item.oldPath);
      const bytes = output || await context.readSource(assets.get(item.oldPath)!);
      if (!output) {
        item.sourceDigest = await digest(bytes);
        const preview = assets.get(item.oldPath)!.previewDigest;
        if (preview && item.sourceDigest !== preview) throw new UserError("sourceChanged", item.oldPath);
      }
      item.targetDigest = output ? await digest(output) : item.sourceDigest;
      item.resultSize = bytes.byteLength;
      context.checkCancelled();
      if (item.oldPath === item.newPath || await fileExists(kernel, item.newDiskPath)) throw new UserError("filenameConflict", item.newPath);
      await kernel.putFile(item.newDiskPath, bytes); item.state = "prepared"; copied++;
    }
    await context.save();
    for (const item of items) {
      context.checkCancelled();
      if (await digest(await kernel.readFile(item.oldDiskPath, context.signal)) !== item.sourceDigest) throw new UserError("sourceChanged", item.oldPath);
      if (await digest(await kernel.readFile(item.newDiskPath, context.signal)) !== item.targetDigest) throw new UserError("writeVerificationFailed", item.newPath);
    }
    const dry = await relinkBatch(kernel, items, true, context.signal);
    for (const item of items) {
      const refs = dry.references.get(item.oldPath)!;
      if (referenceFingerprint(refs) !== referenceFingerprint(item.before)) throw new UserError("sourceChanged", item.oldPath);
      item.plannedAfter = expectedAfter(refs, item.oldPath, item.newPath);
    }
    context.checkCancelled();
    for (const item of items) item.state = "applying";
    await context.save();
    context.progress({ done: job.items.filter(item => ["completed", "skipped"].includes(item.state)).length, total: job.items.length, path: "", stage: "updatingReferences" });
    // Mutations and their final checks must finish even after cancellation.
    const applied = await relinkBatch(kernel, items, false);
    for (const item of items) item.historyPath = applied.report.historyPath;
    const verified = await findReferencesBatch(kernel, items.flatMap(item => [item.oldPath, item.newPath]));
    for (const item of items) {
      const after = verified.get(item.newPath)!;
      if (visibleReferences(verified.get(item.oldPath)!).length || referenceFingerprint(visibleReferences(after)) !== referenceFingerprint(visibleReferences(item.plannedAfter))) throw new UserError("writeVerificationFailed", item.oldPath);
      item.after = after;
    }
    context.checkCancelled();
    for (const item of items) item.state = "completed";
    await context.save(); return true;
  } catch (error) {
    const message = error instanceof UserError ? error.code : String(error);
    const applying = items.filter(item => ["applying", "completed"].includes(item.state));
    for (const item of items) { item.error = message; item.state = applying.includes(item) ? "recovery-required" : "failed"; }
    await context.save();
    if (applying.length) {
      try { await context.restore(applying.reverse()); }
      catch (recoveryError) {
        for (const item of applying) if (item.state !== "restored") { item.state = "recovery-required"; item.error += "; " + String(recoveryError); }
      }
      await context.save();
    }
    throw error;
  }
}

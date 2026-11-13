import { JobItem, Kernel, UserError } from "../types";
import { batchUnsupported, visibleReferences } from "./batch-operations";
import { assertNoUnexpectedReferences, digest, expectedAfter, findReferencesBatch, referenceFingerprint, relinkBatch } from "./references";

export async function restoreBatch(kernel: Kernel, items: JobItem[], context: {
  save(): Promise<void>; checkCancelled(): void; signal?: AbortSignal; recovery: boolean;
}): Promise<boolean> {
  let mutationStarted = false;
  try {
    for (const item of items) {
      context.checkCancelled();
      if (!item.sourceDigest || !item.targetDigest
          || await digest(await kernel.readFile(item.oldDiskPath, context.signal)) !== item.sourceDigest
          || await digest(await kernel.readFile(item.newDiskPath, context.signal)) !== item.targetDigest) throw new UserError("restoreConflict");
    }
    let before: Awaited<ReturnType<typeof findReferencesBatch>>;
    try { before = await findReferencesBatch(kernel, items.flatMap(item => [item.newPath, item.oldPath]), context.signal); }
    catch (error) { if (batchUnsupported(error)) return false; throw error; }
    const active: JobItem[] = [];
    for (const item of items) {
      const refs = before.get(item.newPath)!;
      assertNoUnexpectedReferences(refs, item.after || item.plannedAfter);
      if (visibleReferences(refs).length) active.push(item);
    }
    if (active.length) {
      const mappings = active.map(item => ({ oldPath: item.newPath, newPath: item.oldPath }));
      const dry = await relinkBatch(kernel, mappings, true, context.signal);
      for (const item of active) {
        if (referenceFingerprint(dry.references.get(item.newPath)!) !== referenceFingerprint(before.get(item.newPath)!)) throw new UserError("restoreConflict");
      }
      context.checkCancelled();
      for (const item of active) item.state = "recovery-required";
      await context.save();
      mutationStarted = true;
      await relinkBatch(kernel, mappings, false);
      const after = await findReferencesBatch(kernel, active.flatMap(item => [item.newPath, item.oldPath]));
      for (const item of active) {
        const expected = [...before.get(item.oldPath)!, ...expectedAfter(dry.references.get(item.newPath)!, item.newPath, item.oldPath)];
        if (visibleReferences(after.get(item.newPath)!).length
            || referenceFingerprint(visibleReferences(after.get(item.oldPath)!)) !== referenceFingerprint(visibleReferences(expected))) throw new UserError("restoreConflict");
      }
    }
    for (const item of items) item.state = "restored";
    await context.save(); return true;
  } catch (error) {
    // Recovery can isolate a conflicting item using fresh single-item reads,
    // but must never retry a batch whose mutation outcome is unknown.
    if (!mutationStarted && context.recovery) return false;
    for (const item of items) if (item.state !== "restored") { item.state = "recovery-required"; item.error = String(error); }
    await context.save(); throw error;
  }
}

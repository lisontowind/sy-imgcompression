import { KernelError } from "../api";
import { AssetReference, Kernel, ReferenceReport, UserError } from "../types";
import { requestPath, rewriteReference } from "./paths";

export function assertComplete(report: ReferenceReport): void {
  if (!report || !Array.isArray(report.references) || !Array.isArray(report.skippedNotebooks)) throw new UserError("unsupportedKernel");
  if (report.skippedNotebooks.length) throw new UserError("incompleteScan", report.skippedNotebooks.join(", "));
  if (report.unavailableAttributeViews?.length) throw new UserError("unavailableDatabase", report.unavailableAttributeViews.map(x => `${x.avID}: ${x.reason}`).join(", "));
  const blocked = report.references.filter(ref => !ref.relinkable);
  if (blocked.length) throw new UserError("unsupportedReference", blocked.map(ref => `${ref.type}: ${ref.reason}`).join(", "));
  if (report.items?.some(item => !item.ok)) throw new UserError("incompleteScan", report.items.filter(x => !x.ok).map(x => x.reason).join(", "));
}

export async function findReferences(kernel: Kernel, path: string): Promise<ReferenceReport> {
  let report: ReferenceReport;
  try { report = await kernel.post<ReferenceReport>("/api/asset/findAssetReferences", { path: requestPath(path) }); }
  catch (error) {
    if (error instanceof KernelError && /404|not found|not supported|unknown.*api/i.test(error.message)) throw new UserError("unsupportedKernel");
    throw error;
  }
  assertComplete(report); return report;
}

export async function relink(kernel: Kernel, oldPath: string, newPath: string, dryRun: boolean): Promise<ReferenceReport> {
  const report = await kernel.post<ReferenceReport>("/api/asset/relinkAsset", { oldPath: requestPath(oldPath), newPath: requestPath(newPath), dryRun });
  assertComplete(report); return report;
}

export function referenceKey(ref: AssetReference): string {
  return JSON.stringify([ref.type, ref.notebook || "", ref.rootID || "", ref.blockID || "", ref.avID || "", ref.valueID || "", ref.path || "", ref.reference]);
}
export function referenceFingerprint(refs: AssetReference[]): string {
  // Preserve multiplicity: another identical link in the same block is still a new reference.
  return JSON.stringify(refs.map(referenceKey).sort());
}
export function expectedAfter(refs: AssetReference[], oldPath: string, newPath: string): AssetReference[] {
  return refs.map(ref => ({ ...ref, oldPath: newPath,
    path: ref.type === "annotation-file" ? newPath + ".sya" : ref.path,
    reference: ref.replacement || rewriteReference(ref.reference, newPath, ref.type), replacement: "",
  }));
}
export function assertNoUnexpectedReferences(current: AssetReference[], expected: AssetReference[]): void {
  const allow = new Map<string, number>();
  for (const ref of expected) { const key = referenceKey(ref); allow.set(key, (allow.get(key) || 0) + 1); }
  for (const ref of current) {
    const key = referenceKey(ref), remaining = allow.get(key) || 0;
    if (!remaining) throw new UserError("restoreConflict");
    allow.set(key, remaining - 1);
  }
}

export async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

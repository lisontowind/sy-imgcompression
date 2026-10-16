import { fileExists } from "../api";
import { CompressionClient } from "../compression/client";
import { inspectImage, MAX_BYTES, validateCompression } from "../compression/image-info";
import { AssetIdentity, AssetJob, CompressionOptions, CompressionResult, DocumentAssets, JobItem, JobKind, Journal, Kernel, Progress, RenameOptions, UserError } from "../types";
import { imageRename, newNodeId, validateFilename } from "./naming";
import { basename, isImageAttachment, isImageExtension } from "./paths";
import { cloneOptions } from "./settings";
import { assertNoUnexpectedReferences, digest, expectedAfter, findReferences, referenceFingerprint, relink } from "./references";

export interface JournalStore { load(): Promise<Journal | undefined>; save(journal: Journal): Promise<void> }
export interface Compressor { compress(bytes: ArrayBuffer, options: CompressionOptions): Promise<CompressionResult>; cancel(): void }
export const DEFAULT_COMPRESSION: CompressionOptions = { quality: 82, format: "webp", maxWidth: 0, maxHeight: 0 };
export const DEFAULT_RENAME: RenameOptions = { documentNameMaxBytes: 24 };

export function assignRenamePaths(assets: AssetIdentity[], _title: string, options: RenameOptions): void {
  for (const asset of assets) {
    if (isImageAttachment(asset.extension) && !asset.blockers.length) {
      const priorId = asset.newPath?.match(/(\d{14}-[a-z0-9]{7})(?:\.[^/]*)?$/)?.[1];
      asset.newPath = "assets/" + imageRename(asset.name || basename(asset.path), asset.extension, priorId, asset.renameStem || options.prefix || "image");
    } else asset.newPath = undefined;
  }
}

export class JobManager {
  journal: Journal = { jobs: [] };
  busy = false;
  private cancelled = false;
  private compressor: Compressor;
  onProgress?: (progress: Progress) => void;
  onChange?: () => void;
  constructor(private kernel: Kernel, private store: JournalStore, compressor?: Compressor) { this.compressor = compressor || new CompressionClient(); }
  async initialize(): Promise<void> {
    const saved = await this.store.load();
    if (saved !== undefined) {
      if (!saved || !Array.isArray(saved.jobs) || saved.jobs.some(job => job.schema !== 1 || !Array.isArray(job.items))) throw new UserError("invalidJournal");
      this.journal = saved;
      let changed = false;
      for (const job of saved.jobs) if (job.state === "running") {
        job.state = "interrupted"; changed = true;
        for (const item of job.items) if (item.state === "applying") item.state = "recovery-required";
      }
      if (changed) await this.save();
    }
  }
  private async save(): Promise<void> { await this.store.save(this.journal); this.onChange?.(); }
  cancel(): void { this.cancelled = true; this.compressor.cancel(); }
  private checkCancelled(): void { if (this.cancelled) throw new UserError("cancelled"); }
  async preview(asset: AssetIdentity, options: CompressionOptions): Promise<{ source: ArrayBuffer; result: CompressionResult }> {
    if (this.busy) throw new UserError("busy");
    this.busy = true; this.cancelled = false;
    try {
      const source = await this.readSource(asset);
      asset.previewDigest = await digest(source);
      const result = await this.compressor.compress(source.slice(0), options);
      return { source, result };
    } finally { this.busy = false; }
  }
  private async readSource(asset: AssetIdentity): Promise<ArrayBuffer> {
    if (asset.blockers.length || !asset.diskPath) throw new UserError("blockedAsset", asset.blockers.join(", "));
    // Keep renderer allocations bounded for large non-image attachments too.
    if (asset.size > 256 * 1024 * 1024) throw new UserError("attachmentTooLarge");
    const bytes = await this.kernel.readFile(asset.diskPath);
    if (bytes.byteLength !== asset.size) throw new UserError("sourceChanged", asset.path);
    return bytes;
  }
  async run(document: DocumentAssets, kind: JobKind, options: CompressionOptions | RenameOptions, perImage: ReadonlyMap<string, CompressionOptions> = new Map()): Promise<AssetJob> {
    return this.exclusive(async () => {
      if (kind === "rename") assignRenamePaths(document.assets, document.title, options as RenameOptions);
      const assets = document.assets.filter(asset => asset.selected && !asset.blockers.length && (kind === "compress" ? isImageExtension(asset.extension) : isImageAttachment(asset.extension) && asset.newPath !== asset.path));
      if (!assets.length) throw new UserError(kind === "rename" ? "noChanges" : "selectAssets");
      const effective = new Map(assets.map(asset => [asset.path, kind === "compress" ? cloneOptions(perImage.get(asset.path) || options as CompressionOptions) : undefined]));
      for (const value of effective.values()) if (value) validateCompression(value);
      const job: AssetJob = { schema: 1, id: newNodeId(), kind, documentId: document.id, documentTitle: document.title,
        created: new Date().toISOString(), state: "running", options: kind === "compress" ? cloneOptions(options as CompressionOptions) : { ...options },
        items: assets.map(asset => ({ oldPath: asset.path, newPath: asset.newPath || "", oldDiskPath: asset.diskPath,
          newDiskPath: "", state: "pending", before: [], plannedAfter: [], originalSize: asset.size,
          ...(kind === "compress" ? { compressionOptions: effective.get(asset.path) } : {}) })) };
      this.journal.jobs.unshift(job); await this.save();
      let done = 0;
      try {
        for (let index = 0; index < assets.length; index++) {
          const asset = assets[index], item = job.items[index];
          this.checkCancelled();
          this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "preparing" });
          try {
            if (kind === "rename" && (await fileExists(this.kernel, "/data/" + item.newPath) || job.items.some(other => other !== item && other.newPath.toLowerCase() === item.newPath.toLowerCase()))) {
              item.state = "skipped"; item.error = "filenameConflict"; await this.save(); done++; continue;
            }
            const current = await findReferences(this.kernel, asset.path);
            if (referenceFingerprint(current.references) !== referenceFingerprint(asset.references)) throw new UserError("sourceChanged", asset.path);
            item.before = current.references;
            const source = await this.readSource(asset);
            item.sourceDigest = await digest(source);
            if (asset.previewDigest && item.sourceDigest !== asset.previewDigest) throw new UserError("sourceChanged", asset.path);
            this.checkCancelled();
            let output: ArrayBuffer | undefined;
            if (kind === "compress") {
              if (source.byteLength > MAX_BYTES) throw new UserError("imageTooLarge");
              inspectImage(source);
              const result = await this.compressor.compress(source.slice(0), cloneOptions(item.compressionOptions!));
              item.resultSize = result.bytes.byteLength;
              if (result.bytes.byteLength >= source.byteLength) { item.state = "skipped"; item.error = "noSavings"; await this.save(); done++; continue; }
              output = result.bytes;
              item.newPath = `assets/image-${newNodeId()}${result.extension}`;
            } else item.resultSize = source.byteLength;
            validateFilename(basename(item.newPath));
            item.newDiskPath = "/data/" + item.newPath;
            // Check again immediately before writing; never overwrite an existing file.
            if (await fileExists(this.kernel, item.newDiskPath)) throw new UserError("filenameConflict", item.newPath);
            if (item.oldPath === item.newPath) throw new UserError("filenameConflict", item.newPath);
            item.targetDigest = output ? await digest(output) : item.sourceDigest;
            item.state = "prepared"; await this.save();
            this.checkCancelled();
            await this.kernel.putFile(item.newDiskPath, output || source);
            if (await digest(await this.kernel.readFile(item.oldDiskPath)) !== item.sourceDigest) throw new UserError("sourceChanged", item.oldPath);
            if (await digest(await this.kernel.readFile(item.newDiskPath)) !== item.targetDigest) throw new UserError("writeVerificationFailed");
            const dry = await relink(this.kernel, item.oldPath, item.newPath, true);
            if (referenceFingerprint(dry.references) !== referenceFingerprint(item.before)) throw new UserError("sourceChanged", item.oldPath);
            item.plannedAfter = expectedAfter(dry.references, item.oldPath, item.newPath);
            this.checkCancelled();
            item.state = "applying"; await this.save();
            this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "updatingReferences" });
            // Do not abort a mutation request: its result must be verified before retry or recovery.
            const applied = await relink(this.kernel, item.oldPath, item.newPath, false);
            item.historyPath = applied.historyPath;
            const [remaining, after] = await Promise.all([findReferences(this.kernel, item.oldPath), findReferences(this.kernel, item.newPath)]);
            const actual = after.references.filter(ref => !["annotation-file", "ocr"].includes(ref.type));
            const expected = item.plannedAfter.filter(ref => !["annotation-file", "ocr"].includes(ref.type));
            if (remaining.references.some(ref => !["annotation-file", "ocr"].includes(ref.type))
                || referenceFingerprint(actual) !== referenceFingerprint(expected)) throw new UserError("writeVerificationFailed");
            item.after = after.references;
            if (this.cancelled) { await this.restoreItem(item); throw new UserError("cancelled"); }
            item.state = "completed"; await this.save(); done++;
          } catch (error) {
            item.error = error instanceof UserError ? error.code : String(error);
            if (item.state === "pending" && error instanceof UserError && ["imageTooLarge", "attachmentTooLarge", "animatedImage", "unsupportedImage", "damagedImage", "compressionTimeout"].includes(error.code)) {
              item.state = "skipped"; await this.save(); done++; continue;
            }
            if (item.state === "applying") {
              item.state = "recovery-required"; await this.save();
              try { await this.restoreItem(item); } catch (recoveryError) {
                item.state = "recovery-required"; item.error += "; " + String(recoveryError);
              }
            } else if (item.state !== "restored") item.state = "failed";
            await this.save(); throw error;
          }
        }
        job.state = "completed";
      } catch (error) {
        job.state = "interrupted";
        if (!(error instanceof UserError && error.code === "cancelled")) throw error;
      } finally {
        job.finished = new Date().toISOString(); await this.save();
        this.onProgress?.({ done, total: assets.length, path: "", stage: job.state });
      }
      return job;
    });
  }
  async restore(job: AssetJob): Promise<void> {
    return this.exclusive(async () => {
      for (const item of [...job.items].reverse()) {
        if (!["completed", "applying", "recovery-required"].includes(item.state)) continue;
        this.checkCancelled();
        try { await this.restoreItem(item); await this.save(); }
        catch (error) { item.state = "recovery-required"; item.error = String(error); await this.save(); throw error; }
      }
      job.state = "restored"; await this.save();
    });
  }
  private async restoreItem(item: JobItem): Promise<void> {
    if (!item.sourceDigest || !item.targetDigest) throw new UserError("restoreConflict");
    if (await digest(await this.kernel.readFile(item.oldDiskPath)) !== item.sourceDigest
      || await digest(await this.kernel.readFile(item.newDiskPath)) !== item.targetDigest) throw new UserError("restoreConflict");
    const current = await findReferences(this.kernel, item.newPath);
    const expected = item.after || item.plannedAfter;
    assertNoUnexpectedReferences(current.references, expected);
    if (current.references.some(ref => !["annotation-file", "ocr"].includes(ref.type))) {
      await relink(this.kernel, item.newPath, item.oldPath, true);
      await relink(this.kernel, item.newPath, item.oldPath, false);
      const verified = await findReferences(this.kernel, item.newPath);
      if (verified.references.some(ref => !["annotation-file", "ocr"].includes(ref.type))) throw new UserError("restoreConflict");
    }
    item.state = "restored";
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new UserError("busy");
    this.busy = true; this.cancelled = false;
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request("sy-imgcompression:asset-job", { ifAvailable: true }, async lock => {
          if (!lock) throw new UserError("busy"); return action();
        });
      }
      return await action();
    } finally { this.busy = false; this.onChange?.(); }
  }
}

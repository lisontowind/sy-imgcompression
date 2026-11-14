import { fileExists } from "../api";
import { CompressionClient } from "../compression/client";
import { MAX_BYTES, validateCompression } from "../compression/image-info";
import { AssetIdentity, AssetJob, CompressionOptions, CompressionResult, DocumentAssets, JobItem, JobKind, Journal, Kernel, Progress, RenameOptions, UserError } from "../types";
import { imageRename, newNodeId, validateFilename } from "./naming";
import { basename, isImageAttachment, isImageExtension } from "./paths";
import { cloneOptions } from "./settings";
import { assertNoUnexpectedReferences, digest, expectedAfter, findReferences, referenceFingerprint, relink } from "./references";
import { renameBatch } from "./rename-batch";
import { BatchContext } from "./batch-operations";
import { compressFiles, restoreFile } from "./compress-files";
import { restoreBatch } from "./restore-batch";
import { checkCancelled as checkSignal } from "./cancellation";
import { deleteBackup, planHistoryDeletion } from "./delete-history";

export interface JournalStore { load(): Promise<Journal | undefined>; save(journal: Journal): Promise<void> }
export interface Compressor { compress(bytes: ArrayBuffer, options: CompressionOptions): Promise<CompressionResult>; cancel(): void }
export const DEFAULT_COMPRESSION: CompressionOptions = { quality: 82, format: "original", maxWidth: 0, maxHeight: 0 };
export const DEFAULT_RENAME: RenameOptions = { documentNameMaxBytes: 24 };
const BATCH_FILES = 128;

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
  private previewController?: AbortController;
  private jobController?: AbortController;
  private compressor: Compressor;
  onProgress?: (progress: Progress) => void;
  onChange?: () => void;
  constructor(private kernel: Kernel, private store: JournalStore, compressor?: Compressor) { this.compressor = compressor || new CompressionClient(); }
  async initialize(): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request("sy-imgcompression:asset-job", { ifAvailable: true }, lock => this.reload(!!lock));
    } else await this.reload(true);
  }
  private async reload(recoverInterrupted: boolean): Promise<void> {
    const saved = await this.store.load();
    if (saved !== undefined) {
      if (!saved || !Array.isArray(saved.jobs) || saved.jobs.some(job => !job || job.schema !== 1 || !Array.isArray(job.items))) throw new UserError("invalidJournal");
      const previous = new Map(this.journal.jobs.map(job => [job.id, job]));
      this.journal = { jobs: structuredClone(saved.jobs).map(job => Object.assign(previous.get(job.id) || {}, job) as AssetJob) };
      let changed = false;
      for (const job of this.journal.jobs) if (recoverInterrupted && job.state === "running") {
        job.state = "interrupted"; changed = true;
        for (const item of job.items) if (item.state === "applying") item.state = "recovery-required";
      }
      if (changed) await this.save();
    } else this.journal = { jobs: [] };
  }
  private async save(): Promise<void> { await this.store.save(this.journal); this.onChange?.(); }
  cancel(): void { this.cancelled = true; this.previewController?.abort(); this.jobController?.abort(); this.compressor.cancel(); }
  private checkCancelled(): void { if (this.cancelled) throw new UserError("cancelled"); }
  async preview(asset: AssetIdentity, options: CompressionOptions): Promise<{ source: ArrayBuffer; result: CompressionResult }> {
    if (this.busy) throw new UserError("busy");
    this.busy = true; this.cancelled = false;
    const controller = new AbortController(); this.previewController = controller;
    try {
      validateCompression(options);
      const source = await this.readSource(asset, true, controller.signal);
      this.checkCancelled();
      asset.previewDigest = await digest(source);
      this.checkCancelled();
      const result = await this.compressor.compress(source.slice(0), { ...cloneOptions(options), format: "original" });
      this.checkCancelled();
      return { source, result };
    } finally { this.previewController = undefined; this.busy = false; }
  }
  private async readSource(asset: AssetIdentity, compress = false, signal = this.jobController?.signal): Promise<ArrayBuffer> {
    if (asset.blockers.length || !asset.diskPath) throw new UserError("blockedAsset", asset.blockers.join(", "));
    if (compress && asset.size > MAX_BYTES) throw new UserError("imageTooLarge");
    // Keep renderer allocations bounded for large non-image attachments too.
    if (asset.size > 256 * 1024 * 1024) throw new UserError("attachmentTooLarge");
    const bytes = await this.kernel.readFile(asset.diskPath, signal);
    this.checkCancelled();
    if (bytes.byteLength !== asset.size) throw new UserError("sourceChanged", asset.path);
    return bytes;
  }
  async run(document: DocumentAssets, kind: JobKind, options: CompressionOptions | RenameOptions, perImage: ReadonlyMap<string, CompressionOptions> = new Map()): Promise<AssetJob> {
    return this.exclusive(async () => {
      if (kind === "rename") assignRenamePaths(document.assets, document.title, options as RenameOptions);
      const assets = document.assets.filter(asset => asset.selected && !asset.blockers.length && (kind === "compress" ? isImageExtension(asset.extension) : isImageAttachment(asset.extension) && asset.newPath !== asset.path));
      if (!assets.length) throw new UserError(kind === "rename" ? "noChanges" : "selectAssets");
      const effective = new Map(assets.map(asset => [asset.path, kind === "compress" ? { ...cloneOptions(perImage.get(asset.path) || options as CompressionOptions), format: "original" as const } : undefined]));
      for (const value of effective.values()) if (value) validateCompression(value);
      const job: AssetJob = { schema: 1, id: newNodeId(), kind, documentId: document.id, documentTitle: document.title,
        created: new Date().toISOString(), state: "running", options: kind === "compress" ? { ...cloneOptions(options as CompressionOptions), format: "original" } : { ...options },
        items: assets.map(asset => ({ oldPath: asset.path, newPath: kind === "compress" ? asset.path : asset.newPath || "", oldDiskPath: asset.diskPath,
          newDiskPath: kind === "compress" ? asset.diskPath : "", state: "pending", before: [], plannedAfter: [], originalSize: asset.size,
          ...(kind === "compress" ? { operation: "replace-file" as const, compressionOptions: effective.get(asset.path) } : {}) })) };
      this.journal.jobs.unshift(job); await this.save();
      let done = 0;
      try {
        if (kind === "compress") {
          await compressFiles(this.kernel, job, assets, {
            save: () => this.save(), checkCancelled: () => this.checkCancelled(),
            readSource: asset => this.readSource(asset, true), encode: (source, settings) => this.compressor.compress(source, settings),
            progress: progress => this.onProgress?.(progress), signal: this.jobController?.signal,
          });
          job.state = "completed"; return job;
        }
        const batch: BatchContext = {
          save: () => this.save(), checkCancelled: () => this.checkCancelled(),
          restore: items => this.restoreItems(items, true), readSource: asset => this.readSource(asset), signal: this.jobController?.signal,
          progress: progress => this.onProgress?.(progress),
        };
        if (kind === "rename" && assets.length > 1 && await renameBatch(this.kernel, job, assets, batch)) {
          done = assets.length; job.state = "completed"; return job;
        }
        for (let index = 0; index < assets.length; index++) {
          const asset = assets[index], item = job.items[index];
          if (item.state === "skipped") { done++; continue; }
          this.checkCancelled();
          this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "preparing" });
          try {
            if (await fileExists(this.kernel, "/data/" + item.newPath) || job.items.some(other => other !== item && other.newPath.toLowerCase() === item.newPath.toLowerCase())) {
              item.state = "skipped"; item.error = "filenameConflict"; await this.save(); done++; continue;
            }
            const source = await this.readSource(asset);
            item.sourceDigest = await digest(source);
            if (asset.previewDigest && item.sourceDigest !== asset.previewDigest) throw new UserError("sourceChanged", asset.path);
            this.checkCancelled();
            item.resultSize = source.byteLength;
            validateFilename(basename(item.newPath));
            item.newDiskPath = "/data/" + item.newPath;
            // Browsing and previews defer workspace lookups. Establish a fresh
            // baseline only for an attachment that will actually be changed.
            this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "scanningReferences" });
            const current = await findReferences(this.kernel, asset.path, this.jobController?.signal);
            if (!current.references.length) throw new UserError("noReferences", asset.path);
            if (asset.referencesLoaded !== false && referenceFingerprint(current.references) !== referenceFingerprint(asset.references)) throw new UserError("sourceChanged", asset.path);
            item.before = current.references;
            this.checkCancelled();
            // Check again immediately before writing; never overwrite an existing file.
            if (await fileExists(this.kernel, item.newDiskPath)) throw new UserError("filenameConflict", item.newPath);
            if (item.oldPath === item.newPath) throw new UserError("filenameConflict", item.newPath);
            item.targetDigest = item.sourceDigest;
            item.state = "prepared"; await this.save();
            this.checkCancelled();
            await this.kernel.putFile(item.newDiskPath, source);
            if (await digest(await this.kernel.readFile(item.oldDiskPath, this.jobController?.signal)) !== item.sourceDigest) throw new UserError("sourceChanged", item.oldPath);
            if (await digest(await this.kernel.readFile(item.newDiskPath, this.jobController?.signal)) !== item.targetDigest) throw new UserError("writeVerificationFailed");
            this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "checkingMigration" });
            const dry = await relink(this.kernel, item.oldPath, item.newPath, true, this.jobController?.signal);
            if (referenceFingerprint(dry.references) !== referenceFingerprint(item.before)) throw new UserError("sourceChanged", item.oldPath);
            item.plannedAfter = expectedAfter(dry.references, item.oldPath, item.newPath);
            this.checkCancelled();
            item.state = "applying"; await this.save();
            this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "updatingReferences" });
            // Do not abort a mutation request: its result must be verified before retry or recovery.
            const applied = await relink(this.kernel, item.oldPath, item.newPath, false);
            item.historyPath = applied.historyPath;
            this.onProgress?.({ done, total: assets.length, path: asset.path, stage: "verifyingReferences" });
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
        done = job.items.filter(item => ["completed", "skipped"].includes(item.state)).length;
        job.finished = new Date().toISOString(); await this.save();
        this.onProgress?.({ done, total: assets.length, path: "", stage: job.state });
      }
      return job;
    });
  }
  async restore(job: AssetJob): Promise<void> {
    return this.exclusive(async () => {
      const current = this.journal.jobs.find(value => value.id === job.id);
      if (!current) throw new UserError("restoreConflict");
      if (current.deleting) throw new UserError("historyDeleting");
      job = current;
      await this.restoreItems([...job.items].reverse().filter(item => ["completed", "applying", "recovery-required"].includes(item.state)));
      job.state = "restored"; await this.save();
    });
  }
  async deleteHistory(ids: readonly string[]): Promise<void> {
    return this.exclusive(async () => {
      const selected = new Set(ids), jobs = this.journal.jobs.filter(job => selected.has(job.id));
      if (!jobs.length) return;
      if (new Set(this.journal.jobs.map(job => job.id)).size !== this.journal.jobs.length) throw new UserError("invalidJournal");
      const retained = this.journal.jobs.filter(job => !selected.has(job.id));
      const paths = await planHistoryDeletion(this.kernel, jobs, retained);
      this.checkCancelled();
      // Keep the records until every backup is gone. Persist a marker first so
      // partial deletion cannot leave a misleading restore button after restart.
      for (const job of jobs) job.deleting = true;
      await this.save();
      for (const [index, path] of paths.entries()) {
        this.onProgress?.({ done: index, total: paths.length, path, stage: "deletingBackups" });
        await deleteBackup(this.kernel, path);
      }
      const previous = this.journal.jobs;
      this.journal.jobs = retained;
      try { await this.save(); }
      catch (error) { this.journal.jobs = previous; throw error; }
    });
  }
  private async restoreItems(items: JobItem[], recovery = false): Promise<void> {
    let firstError: unknown;
    for (const item of items.filter(item => item.operation === "replace-file")) {
      if (!recovery) this.checkCancelled();
      // A repeated recovery recognises an already restored file by its hash.
      try { await restoreFile(this.kernel, item, recovery ? undefined : this.jobController?.signal); }
      catch (error) {
        item.state = "recovery-required"; item.error = String(error); await this.save();
        if (!recovery) throw error;
        firstError ??= error;
      }
    }
    items = items.filter(item => item.operation !== "replace-file");
    for (let offset = 0; offset < items.length; offset += BATCH_FILES) {
      const batch = items.slice(offset, offset + BATCH_FILES);
      if (!recovery) this.checkCancelled();
      if (batch.length > 1 && await restoreBatch(this.kernel, batch, {
        save: () => this.save(), checkCancelled: () => { if (!recovery) this.checkCancelled(); },
        signal: recovery ? undefined : this.jobController?.signal, recovery,
      })) continue;
      for (const item of batch) {
        if (!recovery) this.checkCancelled();
        try { await this.restoreItem(item, recovery ? undefined : this.jobController?.signal); await this.save(); }
        catch (error) {
          item.state = "recovery-required"; item.error = String(error); await this.save();
          if (!recovery) throw error;
          firstError ??= error;
        }
      }
    }
    if (firstError) throw firstError;
  }
  private async restoreItem(item: JobItem, signal?: AbortSignal): Promise<void> {
    checkSignal(signal);
    if (!item.sourceDigest || !item.targetDigest) throw new UserError("restoreConflict");
    if (await digest(await this.kernel.readFile(item.oldDiskPath, signal)) !== item.sourceDigest
      || await digest(await this.kernel.readFile(item.newDiskPath, signal)) !== item.targetDigest) throw new UserError("restoreConflict");
    const current = await findReferences(this.kernel, item.newPath, signal);
    const expected = item.after || item.plannedAfter;
    assertNoUnexpectedReferences(current.references, expected);
    if (current.references.some(ref => !["annotation-file", "ocr"].includes(ref.type))) {
      await relink(this.kernel, item.newPath, item.oldPath, true, signal);
      checkSignal(signal);
      await relink(this.kernel, item.newPath, item.oldPath, false);
      const verified = await findReferences(this.kernel, item.newPath);
      if (verified.references.some(ref => !["annotation-file", "ocr"].includes(ref.type))) throw new UserError("restoreConflict");
    }
    item.state = "restored";
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new UserError("busy");
    this.busy = true; this.cancelled = false;
    this.jobController = new AbortController();
    const execute = async () => {
      // Reload only while owning the mutation lock; another window may have
      // completed or restored jobs since this manager was initialized.
      await this.reload(true); this.checkCancelled();
      return action();
    };
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request("sy-imgcompression:asset-job", { ifAvailable: true }, async lock => {
          if (!lock) throw new UserError("busy"); return execute();
        });
      }
      return await execute();
    } finally { this.jobController = undefined; this.busy = false; this.onChange?.(); }
  }
}

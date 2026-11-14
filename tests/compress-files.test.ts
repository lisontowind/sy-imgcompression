import { describe, expect, it, vi } from "vitest";
import { JobManager, DEFAULT_COMPRESSION } from "../src/core/jobs";
import { BACKUP_ROOT } from "../src/core/compress-files";
import { AssetIdentity, CompressionOptions, CompressionResult, DocumentAssets, Journal, Kernel } from "../src/types";
import { png } from "./fixtures";

function sourcePng(): ArrayBuffer { const bytes = new Uint8Array(200); bytes.set(new Uint8Array(png())); return bytes.buffer; }
function setup(count = 1) {
  const files = new Map<string, ArrayBuffer>();
  const assets: AssetIdentity[] = Array.from({ length: count }, (_, index) => {
    const path = `assets/image-${index}.png`, diskPath = "/data/" + path;
    files.set(diskPath, sourcePng());
    return { path, diskPath, name: `image-${index}.png`, extension: ".png", size: 200, selected: true, blockers: [], order: index, references: [], referencesLoaded: false };
  });
  const post = vi.fn(async () => { throw new Error("No workspace request is permitted for compression"); });
  const kernel: Kernel = { post, fileExists: async path => files.has(path),
    readFile: async path => { const bytes = files.get(path); if (!bytes) throw new Error("missing " + path); return bytes.slice(0); },
    putFile: async (path, bytes) => { files.set(path, bytes.slice(0)); },
  };
  const output: CompressionResult = { bytes: png(), mime: "image/png", extension: ".png", width: 16, height: 12, originalWidth: 16, originalHeight: 12 };
  const compressor = { compress: vi.fn(async (_source: ArrayBuffer, _options: CompressionOptions) => output), cancel: vi.fn() };
  let saved: Journal | undefined; const snapshots: Journal[] = [];
  const store = { load: async () => saved, save: async (journal: Journal) => { saved = structuredClone(journal); snapshots.push(saved); } };
  const manager = new JobManager(kernel, store, compressor);
  const document: DocumentAssets = { id: "doc", title: "Images", notebooks: [], assets };
  return { files, kernel, post, output, compressor, manager, document, snapshots, store };
}

describe("image compression without workspace scans", () => {
  it("uses original format for previews even when passed an older WebP preference", async () => {
    const { manager, document, compressor, files, post } = setup();
    await manager.preview(document.assets[0], { ...DEFAULT_COMPRESSION, format: "webp" });
    expect(compressor.compress.mock.calls[0]?.[1]).toMatchObject({ format: "original" });
    expect(files.size).toBe(1); expect(post).not.toHaveBeenCalled();
  });
  it.each([1, 118])("compresses and restores %i images at their original paths without reference APIs", async count => {
    const { manager, document, files, post, compressor, snapshots } = setup(count);
    const job = await manager.run(document, "compress", { ...DEFAULT_COMPRESSION, format: "webp" });
    expect(job.state).toBe("completed"); expect(compressor.compress).toHaveBeenCalledTimes(count);
    expect(job.items.every(item => item.state === "completed" && item.oldPath === item.newPath && item.oldDiskPath === item.newDiskPath)).toBe(true);
    expect(job.items.every(item => item.compressionOptions?.format === "original")).toBe(true);
    for (const item of job.items) {
      expect(files.get(item.backupDiskPath!)).toEqual(sourcePng()); expect(files.get(item.oldDiskPath)).toEqual(png());
      expect(snapshots.some(snapshot => snapshot.jobs[0].items.some(record => record.oldPath === item.oldPath && record.state === "applying" && record.backupDiskPath && record.targetDigest))).toBe(true);
    }
    await manager.restore(job);
    expect(job.state).toBe("restored"); expect(post).not.toHaveBeenCalled();
    for (const item of job.items) expect(files.get(item.oldDiskPath)).toEqual(sourcePng());
  });
  it("skips results without savings before creating a backup", async () => {
    const { manager, document, output, files, post } = setup(); output.bytes = sourcePng();
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.items[0]).toMatchObject({ state: "skipped", error: "noSavings" });
    expect(files.size).toBe(1); expect(post).not.toHaveBeenCalled();
  });
  it("never writes a different image format to an existing filename", async () => {
    const { manager, document, output, files } = setup(); output.mime = "image/webp";
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("writeVerificationFailed");
    expect(files.size).toBe(1); expect(files.get(document.assets[0].diskPath)).toEqual(sourcePng());
  });
  it("leaves the original intact when the backup cannot be saved", async () => {
    const { manager, document, kernel, files } = setup();
    kernel.putFile = async () => { throw new Error("disk full"); };
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("disk full");
    expect(files.get(document.assets[0].diskPath)).toEqual(sourcePng());
  });
  it("rejects a damaged backup before overwriting the original", async () => {
    const { manager, document, kernel, files } = setup(); const put = kernel.putFile;
    kernel.putFile = async (path, bytes) => { await put(path, bytes); if (path.startsWith(BACKUP_ROOT)) files.set(path, png()); };
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("writeVerificationFailed");
    expect(files.get(document.assets[0].diskPath)).toEqual(sourcePng());
  });
  it("stops when the original changes while its backup is being written", async () => {
    const { manager, document, kernel, files } = setup(); const put = kernel.putFile;
    kernel.putFile = async (path, bytes) => { await put(path, bytes); if (path.startsWith(BACKUP_ROOT)) files.set(document.assets[0].diskPath, png(8, 8)); };
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("sourceChanged");
    expect(files.get(document.assets[0].diskPath)).toEqual(png(8, 8));
  });
  it("verifies an unknown write result and restores it without retrying compression", async () => {
    const { manager, document, kernel, files, compressor } = setup(); const put = kernel.putFile; let fail = true;
    kernel.putFile = async (path, bytes) => { await put(path, bytes); if (path === document.assets[0].diskPath && fail) { fail = false; throw new Error("connection lost"); } };
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("connection lost");
    expect(manager.journal.jobs[0].items[0].state).toBe("restored");
    expect(files.get(document.assets[0].diskPath)).toEqual(sourcePng()); expect(compressor.compress).toHaveBeenCalledOnce();
  });
  it("keeps the backup and recovery record if the file has unexpected bytes", async () => {
    const { manager, document, kernel, files } = setup(); const put = kernel.putFile;
    kernel.putFile = async (path, bytes) => { await put(path, bytes); if (path === document.assets[0].diskPath) files.set(path, png(3, 3)); };
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("writeVerificationFailed");
    const job = manager.journal.jobs[0]; expect(job.items[0].state).toBe("recovery-required");
    expect(files.get(job.items[0].backupDiskPath!)).toEqual(sourcePng());
    await expect(manager.restore(job)).rejects.toThrow("restoreConflict");
    expect(files.get(document.assets[0].diskPath)).toEqual(png(3, 3));
  });
  it("finishes file verification then restores the active image on cancellation", async () => {
    const { manager, document, files, post } = setup(2);
    manager.onProgress = progress => { if (progress.stage === "verifyingImage") manager.cancel(); };
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.state).toBe("interrupted"); expect(job.items.map(item => item.state)).toEqual(["restored", "prepared"]);
    expect(files.get(document.assets[0].diskPath)).toEqual(sourcePng()); expect(post).not.toHaveBeenCalled();
  });
  it("refuses recovery if the user edited the compressed image or removed its backup", async () => {
    const { manager, document, files } = setup(); const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    files.set(document.assets[0].diskPath, png(4, 4));
    await expect(manager.restore(job)).rejects.toThrow("restoreConflict");
    files.set(document.assets[0].diskPath, png()); files.delete(job.items[0].backupDiskPath!);
    await expect(manager.restore(job)).rejects.toThrow("missing");
    expect(files.get(document.assets[0].diskPath)).toEqual(png());
  });
  it("recovers a crash-interrupted overwrite from the persisted backup without scans", async () => {
    const { manager, document, kernel, store, compressor, post } = setup();
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    const saved = await store.load(); saved!.jobs[0].state = "running"; saved!.jobs[0].items[0].state = "applying";
    const other = new JobManager(kernel, store, compressor); await other.initialize();
    expect(other.journal.jobs[0].items[0].state).toBe("recovery-required");
    await other.restore(other.journal.jobs[0]);
    expect(await kernel.readFile(job.items[0].oldDiskPath)).toEqual(sourcePng()); expect(post).not.toHaveBeenCalled();
  });
  it("bounds prepared outputs and saves phase checkpoints instead of a log per image", async () => {
    const { manager, document, snapshots, post } = setup(129);
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    const applying = snapshots.filter(snapshot => snapshot.jobs[0].items.some(item => item.state === "applying"));
    expect(applying.map(snapshot => snapshot.jobs[0].items.filter(item => item.state === "applying").length)).toEqual([128, 1]);
    expect(snapshots).toHaveLength(6); expect(job.items.every(item => item.state === "completed")).toBe(true);
    const saved = snapshots.length; await manager.restore(job);
    expect(snapshots.length - saved).toBe(1); expect(post).not.toHaveBeenCalled();
  });
  it("flushes at the output byte budget before reaching the file-count limit", async () => {
    const { manager, document, output, files, snapshots } = setup(9);
    const source = new Uint8Array(5 * 1024 * 1024); source.set(new Uint8Array(png()));
    const encoded = new Uint8Array(4 * 1024 * 1024); encoded.set(new Uint8Array(png())); output.bytes = encoded.buffer;
    for (const asset of document.assets) { asset.size = source.byteLength; files.set(asset.diskPath, source.buffer.slice(0)); }
    await manager.run(document, "compress", DEFAULT_COMPRESSION);
    const applying = snapshots.filter(snapshot => snapshot.jobs[0].items.some(item => item.state === "applying"));
    expect(applying.map(snapshot => snapshot.jobs[0].items.filter(item => item.state === "applying").length)).toEqual([8, 1]);
  });
});

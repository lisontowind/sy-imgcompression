import { describe, expect, it, vi } from "vitest";
import { KernelError } from "../src/api";
import { Compressor, DEFAULT_COMPRESSION, DEFAULT_RENAME, JobManager } from "../src/core/jobs";
import { expectedAfter } from "../src/core/references";
import { requestPath } from "../src/core/paths";
import { AssetIdentity, AssetReference, CompressionResult, DocumentAssets, Journal, Kernel, UserError } from "../src/types";
import { png, ref, report } from "./fixtures";

class BatchKernel implements Kernel {
  files = new Map<string, ArrayBuffer>();
  refs = new Map<string, AssetReference[]>();
  requests: { endpoint: string; body: any }[] = [];
  partialFailure = false;
  unsupported = false;
  incomplete = false;
  writeCount = 0;
  async fileExists(path: string): Promise<boolean> { return this.files.has(path); }
  async readFile(path: string): Promise<ArrayBuffer> {
    const bytes = this.files.get(path); if (!bytes) throw new Error("missing " + path); return bytes.slice(0);
  }
  async putFile(path: string, bytes: ArrayBuffer): Promise<void> { this.writeCount++; this.files.set(path, bytes.slice(0)); }
  async post<T>(endpoint: string, body: any): Promise<T> {
    this.requests.push({ endpoint, body: structuredClone(body) });
    if (endpoint.endsWith("readDir")) return [...this.files.keys()].filter(path => path.startsWith(body.path + "/")).map(path => ({ name: path.split("/").pop(), isDir: false })) as T;
    if (endpoint.endsWith("findAssetReferences")) {
      if (body.paths && this.unsupported) throw new KernelError(endpoint, undefined, "[path] is required");
      const paths: string[] = body.paths || [body.path];
      const items = paths.map(path => ({ oldPath: path, newPath: "", ok: true, reason: "", updated: 0,
        references: structuredClone(this.refs.get(decodeURIComponent(path)) || []) }));
      return { ...report(items.flatMap(item => item.references)), ...(body.paths ? { items } : {}), skippedNotebooks: this.incomplete ? ["encrypted"] : [] } as T;
    }
    if (endpoint.endsWith("relinkAsset")) {
      const mappings: { oldPath: string; newPath: string }[] = body.mappings || [body];
      const items = mappings.map(mapping => {
        const oldPath = decodeURIComponent(mapping.oldPath), newPath = decodeURIComponent(mapping.newPath);
        const refs = structuredClone(this.refs.get(oldPath) || []);
        const before = refs.map(reference => ({ ...reference, replacement: requestPath(newPath) }));
        if (!body.dryRun) {
          const count = this.partialFailure ? 1 : refs.length;
          this.refs.set(oldPath, refs.slice(count));
          this.refs.set(newPath, [...(this.refs.get(newPath) || []), ...expectedAfter(before.slice(0, count), oldPath, newPath)]);
          if (this.partialFailure) { this.partialFailure = false; throw new Error("connection lost after partial write"); }
        }
        return { oldPath: mapping.oldPath, newPath: mapping.newPath, ok: true, reason: "", updated: body.dryRun ? 0 : refs.length, references: before };
      });
      return { ...report(items.flatMap(item => item.references)), ...(body.mappings ? { items } : {}), dryRun: body.dryRun } as T;
    }
    throw new Error(endpoint);
  }
}

function setup(count = 2, compressor?: Compressor) {
  const kernel = new BatchKernel();
  const assets: AssetIdentity[] = Array.from({ length: count }, (_, index) => {
    const name = `${index === 0 ? "原图 %" : "source"}-${index}-20261016000100-${String(index).padStart(7, "0")}.png`;
    const path = "assets/" + name, diskPath = "/data/" + path;
    const refs = [ref(`block-${index}`, requestPath(path)), ref(`shared-${index}`, requestPath(path))];
    kernel.files.set(diskPath, png()); kernel.refs.set(path, refs);
    return { path, diskPath, name, extension: ".png", size: 45, references: [], referencesLoaded: false, blockers: [], selected: true, order: index };
  });
  const document: DocumentAssets = { id: "doc", title: "Batch", notebooks: [], assets };
  let saved: Journal | undefined;
  const snapshots: Journal[] = [];
  const manager = new JobManager(kernel, { load: async () => saved, save: async journal => { saved = structuredClone(journal); snapshots.push(saved); } }, compressor);
  return { kernel, manager, document, snapshots, saved: () => saved };
}

describe("batch image renaming", () => {
  it("renames 118 images with four workspace requests and durable phase checkpoints", async () => {
    const { kernel, manager, document, snapshots } = setup(118);
    const job = await manager.run(document, "rename", { ...DEFAULT_RENAME, prefix: "照片" });
    expect(job.state).toBe("completed"); expect(job.items.every(item => item.state === "completed")).toBe(true);
    const workspace = kernel.requests.filter(request => /findAssetReferences|relinkAsset/.test(request.endpoint));
    expect(workspace).toHaveLength(4);
    expect(workspace.map(request => request.body.paths?.length || request.body.mappings?.length)).toEqual([118, 118, 118, 236]);
    expect(snapshots).toHaveLength(5);
    expect(kernel.requests.filter(request => request.endpoint.endsWith("readDir"))).toHaveLength(1);
    expect(snapshots[2].jobs[0].items.every(item => item.state === "applying" && item.sourceDigest && item.plannedAfter.length === 2)).toBe(true);
    for (const item of job.items) {
      expect(kernel.refs.get(item.oldPath)).toEqual([]); expect(kernel.refs.get(item.newPath)).toHaveLength(2);
      expect(await kernel.readFile(item.newDiskPath)).toEqual(await kernel.readFile(item.oldDiskPath));
    }
    const restoreStart = kernel.requests.length;
    await manager.restore(job);
    expect(kernel.requests.slice(restoreStart).filter(request => /findAssetReferences|relinkAsset/.test(request.endpoint))).toHaveLength(4);
    expect(job.state).toBe("restored");
    for (const item of job.items) expect(kernel.refs.get(item.oldPath)).toHaveLength(2);
  });
  it("falls back only when an old kernel rejects the read-only batch request", async () => {
    const { kernel, manager, document } = setup(); kernel.unsupported = true;
    const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.items.every(item => item.state === "completed")).toBe(true);
    expect(kernel.requests.filter(request => request.body.mappings)).toHaveLength(0);
  });
  it("blocks all copies when the workspace scan is incomplete", async () => {
    const { kernel, manager, document } = setup(); kernel.incomplete = true;
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("incompleteScan");
    expect(kernel.writeCount).toBe(0);
  });
  it("rejects missing batch results instead of assuming that there are no references", async () => {
    const { kernel, manager, document } = setup(); const post = kernel.post.bind(kernel);
    kernel.post = async (endpoint, body) => {
      const response: any = await post(endpoint, body);
      if ((body as any).paths) response.items.pop();
      return response;
    };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("unsupportedKernel");
    expect(kernel.writeCount).toBe(0);
  });
  it("blocks copies if references viewed earlier have changed", async () => {
    const { kernel, manager, document } = setup(); document.assets[1].referencesLoaded = true;
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("sourceChanged");
    expect(kernel.writeCount).toBe(0);
  });
  it("skips filename conflicts and includes only eligible images in the batch", async () => {
    const { kernel, manager, document } = setup();
    const target = "assets/image-20261016000100-0000000.png"; kernel.files.set("/data/" + target, png(2, 2));
    const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.items.map(item => item.state)).toEqual(["skipped", "completed"]);
    expect(await kernel.readFile("/data/" + target)).toEqual(png(2, 2));
    expect(kernel.requests.find(request => request.body.mappings)?.body.mappings).toHaveLength(1);
  });
  it("does not overwrite a target created after the initial directory scan", async () => {
    const { kernel, manager, document } = setup();
    let target = "";
    kernel.fileExists = async path => { target = path; kernel.files.set(path, png(2, 2)); return true; };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("filenameConflict");
    expect(kernel.writeCount).toBe(0); expect(await kernel.readFile(target)).toEqual(png(2, 2));
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
  it("cancels during copy preparation without changing references", async () => {
    const { kernel, manager, document } = setup(); const put = kernel.putFile.bind(kernel);
    kernel.putFile = async (path, bytes) => { await put(path, bytes); manager.cancel(); };
    const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.state).toBe("interrupted");
    expect(kernel.requests.some(request => request.body.mappings)).toBe(false);
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
  it("skips oversized images before workspace queries or file reads", async () => {
    const { kernel, manager, document } = setup();
    for (const asset of document.assets) asset.size = 256 * 1024 * 1024 + 1;
    kernel.readFile = async () => { throw new Error("must not read oversized files"); };
    const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.items.every(item => item.state === "skipped" && item.error === "attachmentTooLarge")).toBe(true);
    expect(kernel.requests.some(request => /findAssetReferences|relinkAsset/.test(request.endpoint))).toBe(false);
    expect(kernel.writeCount).toBe(0);
  });
  it("checks earlier originals again after preparing the last copy", async () => {
    const { kernel, manager, document } = setup(); const put = kernel.putFile.bind(kernel);
    kernel.putFile = async (path, bytes) => {
      await put(path, bytes);
      if (kernel.writeCount === 2) kernel.files.set(document.assets[0].diskPath, png(4, 4));
    };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("sourceChanged");
    expect(kernel.requests.some(request => request.body.mappings)).toBe(false);
  });
  it("checks earlier targets again after preparing the last copy", async () => {
    const { kernel, manager, document } = setup(); const put = kernel.putFile.bind(kernel);
    let firstTarget = "";
    kernel.putFile = async (path, bytes) => {
      await put(path, bytes);
      if (kernel.writeCount === 1) firstTarget = path;
      else kernel.files.set(firstTarget, png(4, 4));
    };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("writeVerificationFailed");
    expect(kernel.requests.some(request => request.body.mappings)).toBe(false);
  });
  it("blocks migration if a reference changes while copies are being prepared", async () => {
    const { kernel, manager, document } = setup(); const put = kernel.putFile.bind(kernel);
    kernel.putFile = async (path, bytes) => {
      await put(path, bytes);
      if (kernel.writeCount === 2) kernel.refs.get(document.assets[0].path)!.push(ref("new-during-copy", requestPath(document.assets[0].path)));
    };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("sourceChanged");
    expect(kernel.requests.some(request => request.body.mappings && !request.body.dryRun)).toBe(false);
  });
  it("rejects a corrupted prepared copy before changing any references", async () => {
    const { kernel, manager, document } = setup(); const put = kernel.putFile.bind(kernel);
    kernel.putFile = async (path, bytes) => { await put(path, bytes); kernel.files.set(path, png(4, 4)); };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("writeVerificationFailed");
    expect(kernel.requests.some(request => request.body.mappings)).toBe(false);
  });
  it("recovers every affected image after an unknown partial batch mutation", async () => {
    const { kernel, manager, document, snapshots } = setup(); kernel.partialFailure = true;
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("connection lost");
    expect(snapshots.some(journal => journal.jobs[0].items.every(item => item.state === "recovery-required"))).toBe(true);
    expect(manager.journal.jobs[0].items.every(item => item.state === "restored")).toBe(true);
    const mutations = kernel.requests.filter(request => request.body.mappings && !request.body.dryRun);
    expect(mutations).toHaveLength(2);
    expect(mutations[1].body.mappings.every((mapping: { newPath: string }) => document.assets.some(asset => requestPath(asset.path) === mapping.newPath))).toBe(true);
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
  it("waits for migration verification then restores the batch when cancelled", async () => {
    const { kernel, manager, document } = setup();
    manager.onProgress = progress => { if (progress.stage === "updatingReferences") manager.cancel(); };
    const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.state).toBe("interrupted"); expect(job.items.every(item => item.state === "restored")).toBe(true);
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
  it("keeps recovery available if a concurrent edit adds an unexpected new reference", async () => {
    const { kernel, manager, document } = setup(); const post = kernel.post.bind(kernel);
    kernel.post = async (endpoint, body: any) => {
      const response: any = await post(endpoint, body);
      if (body.mappings && !body.dryRun) {
        const target = decodeURIComponent(body.mappings[0].newPath);
        kernel.refs.get(target)!.push(ref("user-added", requestPath(target)));
      }
      return response;
    };
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("writeVerificationFailed");
    expect(manager.journal.jobs[0].items.map(item => item.state)).toEqual(["recovery-required", "restored"]);
  });
});

function compressionSetup(count = 2) {
  const output: CompressionResult = { bytes: new ArrayBuffer(20), width: 16, height: 12, originalWidth: 16, originalHeight: 12, extension: ".webp", mime: "image/webp" };
  const compressor = { compress: vi.fn(async () => output), cancel: vi.fn() };
  return { ...setup(count, compressor), output, compressor };
}
describe("bounded batch compression and recovery", () => {
  it("compresses 118 images with four fresh workspace requests and five journal writes", async () => {
    const { kernel, manager, document, snapshots, compressor } = compressionSetup(118);
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.items.every(item => item.state === "completed")).toBe(true);
    expect(compressor.compress).toHaveBeenCalledTimes(118);
    expect(kernel.requests.filter(request => /findAssetReferences|relinkAsset/.test(request.endpoint))).toHaveLength(4);
    expect(snapshots).toHaveLength(5);
    const start = kernel.requests.length; await manager.restore(job);
    expect(kernel.requests.slice(start).filter(request => /findAssetReferences|relinkAsset/.test(request.endpoint))).toHaveLength(4);
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
  it("flushes bounded batches instead of retaining an unlimited number of outputs", async () => {
    const { kernel, manager, document } = compressionSetup(129);
    await manager.run(document, "compress", DEFAULT_COMPRESSION);
    const writes = kernel.requests.filter(request => request.body.mappings && !request.body.dryRun);
    expect(writes.map(request => request.body.mappings.length)).toEqual([128, 1]);
    expect(kernel.requests.filter(request => /findAssetReferences|relinkAsset/.test(request.endpoint))).toHaveLength(8);
  });
  it("flushes the output byte budget before reaching the image count limit", async () => {
    const { kernel, manager, document, output } = compressionSetup(9);
    for (const asset of document.assets) {
      const source = new Uint8Array(5 * 1024 * 1024); source.set(new Uint8Array(png()));
      kernel.files.set(asset.diskPath, source.buffer); asset.size = source.byteLength;
    }
    output.bytes = new ArrayBuffer(4 * 1024 * 1024);
    await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(kernel.requests.filter(request => request.body.mappings && !request.body.dryRun).map(request => request.body.mappings.length)).toEqual([8, 1]);
  });
  it("does not query references or write a journal for every image without savings", async () => {
    const { kernel, manager, document, snapshots, output } = compressionSetup(118); output.bytes = new ArrayBuffer(100);
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.items.every(item => item.state === "skipped" && item.error === "noSavings")).toBe(true);
    expect(kernel.requests.some(request => /findAssetReferences|relinkAsset/.test(request.endpoint))).toBe(false);
    expect(kernel.writeCount).toBe(0); expect(snapshots).toHaveLength(3);
  });
  it("reuses encoded bytes during an old-kernel fallback instead of compressing twice", async () => {
    const { kernel, manager, document, compressor } = compressionSetup(); kernel.unsupported = true;
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.items.every(item => item.state === "completed")).toBe(true);
    expect(compressor.compress).toHaveBeenCalledTimes(2);
    expect(kernel.requests.some(request => request.body.mappings)).toBe(false);
  });
  it("rejects stale encoded bytes if a source changes before an old-kernel fallback", async () => {
    const { kernel, manager, document } = compressionSetup(); kernel.unsupported = true;
    const post = kernel.post.bind(kernel);
    kernel.post = async (endpoint, body: any) => {
      if (body.paths) kernel.files.set(document.assets[0].diskPath, png(4, 4));
      return post(endpoint, body) as any;
    };
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("sourceChanged");
    expect(kernel.writeCount).toBe(0);
  });
  it("aborts a read-only batch baseline before any target file is written", async () => {
    const { kernel, manager, document } = compressionSetup(); const post = kernel.post.bind(kernel);
    let current: AbortSignal | undefined;
    kernel.post = async (endpoint, body: any, signal?: AbortSignal) => {
      if (body.paths) { current = signal; return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new UserError("cancelled")), { once: true })) as any; }
      return post(endpoint, body) as any;
    };
    const running = manager.run(document, "compress", DEFAULT_COMPRESSION);
    await vi.waitFor(() => expect(current).toBeDefined()); manager.cancel();
    expect((await running).state).toBe("interrupted"); expect(current!.aborted).toBe(true); expect(kernel.writeCount).toBe(0);
  });
  it("refuses all attachment writes on an incomplete workspace", async () => {
    const { kernel, manager, document } = compressionSetup(); kernel.incomplete = true;
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("incompleteScan");
    expect(kernel.writeCount).toBe(0);
  });
  it("verifies and restores a partially applied compression batch", async () => {
    const { kernel, manager, document } = compressionSetup(); kernel.partialFailure = true;
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("connection lost");
    expect(manager.journal.jobs[0].items.every(item => item.state === "restored")).toBe(true);
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
  it("blocks batch recovery before any mutation when a new reference was added", async () => {
    const { kernel, manager, document } = compressionSetup(); const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    kernel.refs.get(job.items[0].newPath)!.push(ref("new-reference", job.items[0].newPath));
    const start = kernel.requests.length;
    await expect(manager.restore(job)).rejects.toThrow("restoreConflict");
    expect(kernel.requests.slice(start).some(request => request.body.mappings && !request.body.dryRun)).toBe(false);
  });
  it("does not automatically retry an unknown batch restore and permits explicit checked recovery", async () => {
    const { kernel, manager, document } = compressionSetup(); const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    kernel.partialFailure = true; const start = kernel.requests.length;
    await expect(manager.restore(job)).rejects.toThrow("connection lost");
    expect(kernel.requests.slice(start).filter(request => request.body.mappings && !request.body.dryRun)).toHaveLength(1);
    expect(job.items.every(item => item.state === "recovery-required")).toBe(true);
    await manager.restore(job);
    expect(job.state).toBe("restored");
    for (const asset of document.assets) expect(kernel.refs.get(asset.path)).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { JobManager, assignRenamePaths, DEFAULT_COMPRESSION, DEFAULT_RENAME, JournalStore } from "../src/core/jobs";
import { AssetIdentity, AssetReference, CompressionOptions, CompressionResult, DocumentAssets, Journal, Kernel } from "../src/types";
import { expectedAfter } from "../src/core/references";
import { png, ref, report } from "./fixtures";

class FakeKernel implements Kernel {
  files = new Map<string, ArrayBuffer>([["/data/assets/a.png", png()]]);
  refs = new Map<string, AssetReference[]>([["assets/a.png", [ref("one"), ref("two")]]]);
  mutations = 0;
  failWrite = false;
  partialFailure = false;
  async readFile(path: string): Promise<ArrayBuffer> { const b = this.files.get(path); if (!b) throw new Error("missing " + path); return b.slice(0); }
  async putFile(path: string, bytes: ArrayBuffer): Promise<void> { this.mutations++; if (this.failWrite) throw new Error("disk full"); this.files.set(path, bytes.slice(0)); }
  async post<T>(endpoint: string, body: unknown): Promise<T> {
    const input = body as Record<string, string | boolean>;
    if (endpoint.endsWith("readDir")) return [...this.files.keys()].filter(path => path.startsWith(input.path + "/")).map(path => ({ name: path.split("/").pop(), isDir: false })) as T;
    if (endpoint.endsWith("findAssetReferences")) return report(structuredClone(this.refs.get(decodeURI(input.path as string)) || [])) as T;
    if (endpoint.endsWith("copyFile")) { await this.putFile(input.dest as string, await this.readFile(input.src as string)); return undefined as T; }
    if (endpoint.endsWith("relinkAsset")) {
      const oldPath = decodeURI(input.oldPath as string), newPath = decodeURI(input.newPath as string);
      const refs = structuredClone(this.refs.get(oldPath) || []);
      const before = refs.map(reference => ({ ...reference, replacement: newPath }));
      if (!input.dryRun) {
        this.mutations++;
        const count = this.partialFailure ? 1 : refs.length;
        this.refs.set(oldPath, refs.slice(count));
        this.refs.set(newPath, [...(this.refs.get(newPath) || []), ...expectedAfter(before.slice(0, count), oldPath, newPath)]);
        if (this.partialFailure) { this.partialFailure = false; throw new Error("connection lost after partial write"); }
      }
      return { ...report(before), dryRun: !!input.dryRun, updated: input.dryRun ? 0 : refs.length } as T;
    }
    throw new Error(endpoint);
  }
}
function setup() {
  const kernel = new FakeKernel();
  let saved: Journal | undefined;
  const store: JournalStore = { load: async () => saved, save: async journal => { saved = structuredClone(journal); } };
  const asset: AssetIdentity = { path: "assets/a.png", diskPath: "/data/assets/a.png", name: "a.png", extension: ".png", size: 45,
    references: structuredClone(kernel.refs.get("assets/a.png")!), blockers: [], selected: true, order: 0 };
  const document: DocumentAssets = { id: "20261016000000-abcdefg", title: "项目实施方案验收记录", notebooks: [], assets: [asset] };
  const output: CompressionResult = { bytes: new ArrayBuffer(20), width: 16, height: 12, originalWidth: 16, originalHeight: 12, extension: ".webp", mime: "image/webp" };
  const compressor = { compress: vi.fn(async (_bytes: ArrayBuffer, _options: CompressionOptions) => output), cancel: vi.fn() };
  const manager = new JobManager(kernel, store, compressor);
  return { kernel, manager, store, document, output, compressor, getSaved: () => saved };
}
describe("durable attachment jobs", () => {
  it("compresses a shared attachment once and migrates all references", async () => {
    const { kernel, manager, document, getSaved } = setup();
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.state).toBe("completed"); expect(job.items[0].state).toBe("completed");
    expect(kernel.refs.get("assets/a.png")).toEqual([]);
    expect(kernel.refs.get(job.items[0].newPath)).toHaveLength(2);
    expect(kernel.files.has("/data/assets/a.png")).toBe(true);
    expect(getSaved()?.jobs[0].items[0].after).toHaveLength(2);
  });
  it("restores checked references without deleting either file", async () => {
    const { kernel, manager, document } = setup();
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    await manager.restore(job);
    expect(job.state).toBe("restored"); expect(kernel.refs.get("assets/a.png")).toHaveLength(2); expect(kernel.files.size).toBe(2);
  });
  it("blocks recovery when a user adds a new reference", async () => {
    const { kernel, manager, document } = setup(); const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    kernel.refs.get(job.items[0].newPath)!.push({ ...ref("user-added"), reference: job.items[0].newPath });
    const writes = kernel.mutations;
    await expect(manager.restore(job)).rejects.toThrow("restoreConflict");
    expect(kernel.mutations).toBe(writes); expect(job.items[0].state).toBe("recovery-required");
  });
  it("blocks recovery if the source file changed", async () => {
    const { kernel, manager, document } = setup(); const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    kernel.files.set("/data/assets/a.png", png(4, 4));
    await expect(manager.restore(job)).rejects.toThrow("restoreConflict");
  });
  it("performs no writes if references changed after scanning", async () => {
    const { kernel, manager, document } = setup(); kernel.refs.get("assets/a.png")!.push(ref("added-before-apply"));
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("sourceChanged"); expect(kernel.mutations).toBe(0);
  });
  it("keeps the original on upload failure", async () => {
    const { kernel, manager, document } = setup(); kernel.failWrite = true;
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("disk full");
    expect(kernel.refs.get("assets/a.png")).toHaveLength(2); expect(manager.journal.jobs[0].state).toBe("interrupted");
  });
  it("rolls back a partial mutation whose request failed", async () => {
    const { kernel, manager, document } = setup(); kernel.partialFailure = true;
    await expect(manager.run(document, "compress", DEFAULT_COMPRESSION)).rejects.toThrow("connection lost");
    expect(kernel.refs.get("assets/a.png")).toHaveLength(2); expect(manager.journal.jobs[0].items[0].state).toBe("restored");
  });
  it("skips a result without savings without uploading anything", async () => {
    const { kernel, manager, document, output } = setup(); output.bytes = new ArrayBuffer(100);
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION); expect(job.items[0].state).toBe("skipped"); expect(kernel.mutations).toBe(0);
  });
  it("uses image names and preserves the original bytes", async () => {
    const { kernel, manager, document } = setup(); const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.items[0].newPath).toMatch(/^assets\/image-\d{14}-[a-z0-9]{7}\.png$/);
    expect(await kernel.readFile(job.items[0].newDiskPath)).toEqual(await kernel.readFile(job.items[0].oldDiskPath));
  });
  it("applies previewed individual names with a custom batch prefix and restores them", async () => {
    const { kernel, manager, document } = setup(); document.assets[0].renameStem = "Cover";
    const options = { ...DEFAULT_RENAME, prefix: "Photos" };
    assignRenamePaths(document.assets, document.title, options); const previewed = document.assets[0].newPath;
    const job = await manager.run(document, "rename", options);
    expect(job.items[0].newPath).toBe(previewed); expect(job.items[0].newPath).toMatch(/^assets\/Cover-/);
    expect(job.options).toMatchObject({ prefix: "Photos" });
    await manager.restore(job); expect(kernel.refs.get("assets/a.png")).toHaveLength(2);
  });
  it("rejects an unsafe individual name before saving a job or writing a file", async () => {
    const { kernel, manager, document, getSaved } = setup(); document.assets[0].renameStem = "../escape";
    await expect(manager.run(document, "rename", { ...DEFAULT_RENAME, prefix: "Photos" })).rejects.toThrow("invalidFilename");
    expect(kernel.mutations).toBe(0); expect(getSaved()).toBeUndefined();
  });
  it("snapshots effective per-image parameters and leaves other images on global settings", async () => {
    const { kernel, manager, document, compressor } = setup();
    const second = { ...structuredClone(document.assets[0]), path: "assets/b.png", name: "b.png", diskPath: "/data/assets/b.png", references: [ref("b")] };
    kernel.files.set(second.diskPath, png()); kernel.refs.set(second.path, second.references); document.assets.push(second);
    const custom: CompressionOptions = { ...DEFAULT_COMPRESSION, quality: 60, resize: { mode: "percent", value: 50 } };
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION, new Map([["assets/a.png", custom]]));
    expect(compressor.compress.mock.calls.map(call => call[1].quality)).toEqual([60, 82]);
    custom.resize!.value = 25;
    expect(job.items[0].compressionOptions!.resize!.value).toBe(50);
    expect(job.items[1].compressionOptions!.quality).toBe(82);
  });
  it("skips naming conflicts without writing or migrating references", async () => {
    const { kernel, manager, document } = setup();
    document.assets[0].newPath = "assets/image-20261016010101-abc1234.png";
    kernel.files.set("/data/" + document.assets[0].newPath, png());
    const job = await manager.run(document, "rename", DEFAULT_RENAME);
    expect(job.items[0]).toMatchObject({ state: "skipped", error: "filenameConflict" }); expect(kernel.mutations).toBe(0);
  });
  it("treats already normalized images and non-images as no changes", async () => {
    const { kernel, manager, document } = setup();
    document.assets[0].path = "assets/image-20261016010101-abc1234.png"; document.assets[0].name = "image-20261016010101-abc1234.png";
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("noChanges");
    document.assets[0].extension = ".pdf"; document.assets[0].name = "a.pdf";
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("noChanges"); expect(kernel.mutations).toBe(0);
  });
  it("restores old schema-1 jobs without per-image options", async () => {
    const { manager, document } = setup(); const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    delete job.items[0].compressionOptions; await manager.restore(job); expect(job.state).toBe("restored");
  });
  it("marks crash-interrupted operations for review without replaying", async () => {
    const { kernel, manager, document, getSaved, store } = setup(); await manager.run(document, "compress", DEFAULT_COMPRESSION);
    const saved = getSaved()!; saved.jobs[0].state = "running"; saved.jobs[0].items[0].state = "applying";
    const reloaded = new JobManager(kernel, { ...store, load: async () => saved }); const writes = kernel.mutations;
    await reloaded.initialize(); expect(reloaded.journal.jobs[0].state).toBe("interrupted");
    expect(reloaded.journal.jobs[0].items[0].state).toBe("recovery-required"); expect(kernel.mutations).toBe(writes);
  });
  it("refuses mutations if saving the journal fails", async () => {
    const { kernel, document } = setup(); const manager = new JobManager(kernel, { load: async () => undefined, save: async () => { throw new Error("storage full"); } });
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("storage full"); expect(kernel.mutations).toBe(0);
  });
  it("cancels an in-flight migration only after verifying and restoring it", async () => {
    const { kernel, manager, document } = setup();
    manager.onProgress = progress => { if (progress.stage === "updatingReferences") manager.cancel(); };
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.state).toBe("interrupted"); expect(job.items[0].state).toBe("restored");
    expect(kernel.refs.get("assets/a.png")).toHaveLength(2);
  });
  it("blocks a simultaneous job while another worker is running", async () => {
    const { kernel, document, store, output } = setup();
    let finish!: (result: CompressionResult) => void;
    const compressor = { compress: vi.fn(() => new Promise<CompressionResult>(resolve => { finish = resolve; })), cancel: vi.fn() };
    const manager = new JobManager(kernel, store, compressor);
    const first = manager.run(document, "compress", DEFAULT_COMPRESSION);
    await vi.waitFor(() => expect(compressor.compress).toHaveBeenCalledOnce());
    await expect(manager.run(document, "rename", DEFAULT_RENAME)).rejects.toThrow("busy");
    finish(output); await first;
  });
  it("skips an animated source instead of aborting the batch", async () => {
    const { kernel, manager, document } = setup();
    kernel.files.set("/data/assets/a.png", png(16, 12, true)); document.assets[0].size = 65;
    const job = await manager.run(document, "compress", DEFAULT_COMPRESSION);
    expect(job.items[0].state).toBe("skipped"); expect(job.items[0].error).toBe("animatedImage"); expect(kernel.mutations).toBe(0);
  });
});

// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DEFAULT_COMPRESSION, JobManager } from "../src/core/jobs";
import { SourceNode } from "../src/core/document-source";
import { DocumentAssets, Journal, Kernel } from "../src/types";
import { png, webp } from "./fixtures";
// Node WebCrypto rejects ArrayBuffers created in jsdom's separate realm.
beforeEach(() => { vi.spyOn(crypto.subtle, "digest").mockImplementation(async (_algorithm, data) => {
  const hash = createHash("sha256").update(Buffer.from(new Uint8Array(data as ArrayBuffer))).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer;
}); });

const id = "20261117000100-doc0001", block = "20261117000100-block01", html = "20261117000100-html001";
const book = "20261117000100-book001", db = "20261117000100-dbase01", embed = "20261117000100-embed01", foreign = "20261117000100-other01";
function setup(format: "original" | "webp" = "webp") {
  const path = "assets/原图 %25.png", encoded = path.split("/").map(encodeURIComponent).join("/");
  const source = new Uint8Array(200); source.set(new Uint8Array(png()));
  const files = new Map([["/data/" + path, source.buffer as ArrayBuffer]]);
  const dom = new Map([
    [block, `<div data-node-id="${block}" data-type="NodeParagraph"><div contenteditable="true"><img src="/${encoded}?x=1#frag"><a href="${encoded}">attachment</a><img src="${encoded}"></div></div>`],
    [html, `<div data-node-id="${html}" data-type="NodeHTMLBlock"><protyle-html data-content="&lt;img src=&quot;${encoded}&quot;&gt;"></protyle-html></div>`],
  ]);
  let title = `background-image: url("${encoded}")`, saved: Journal | undefined;
  let tree: SourceNode = { ID: id, Type: "NodeDocument", Properties: {}, Children: [
    { ID: block, Type: "NodeParagraph" }, { ID: html, Type: "NodeHTMLBlock" },
    { ID: db, Type: "NodeAttributeView", AttributeViewID: db }, { ID: embed, Type: "NodeBlockQueryEmbed" },
  ] };
  const sharedDOM = `<div data-node-id="${db}" data-type="NodeAttributeView"><img src="${encoded}"></div><div data-node-id="${embed}"><div data-node-id="${foreign}"><img src="${encoded}"></div></div>`;
  const snapshots: Journal[] = [];
  const post = vi.fn(async (endpoint: string, body: any) => {
    if (endpoint.endsWith("getBlockInfo")) return { box: book, path: `/${id}.sy` };
    if (endpoint.endsWith("getBlockDOM")) return { dom: body.id === id ? `<div data-node-id="${id}">${[...dom.values()].join("")}${sharedDOM}</div>` : dom.get(body.id) };
    if (endpoint.endsWith("getBlockAttrs")) return { "title-img": title };
    if (endpoint.endsWith("setBlockAttrs")) { title = body.attrs["title-img"]; return null; }
    if (endpoint.endsWith("updateBlock")) { dom.set(body.id, body.data); return []; }
    throw new Error("Unexpected request " + endpoint);
  });
  const kernel: Kernel = { post: post as Kernel["post"], fileExists: async path => files.has(path),
    readFile: async path => path.endsWith(".sy") ? new TextEncoder().encode(JSON.stringify({ ...tree, Properties: { ...tree.Properties, "title-img": title } })).buffer
      : files.get(path)?.slice(0) || Promise.reject(new Error("missing " + path)),
    putFile: async (path, bytes) => { files.set(path, bytes.slice(0)); } };
  const compressor = { compress: vi.fn(async () => ({ bytes: format === "webp" ? webp() : png(), extension: "." + (format === "webp" ? "webp" : "png"), mime: "image/" + (format === "webp" ? "webp" : "png"), width: 16, height: 12, originalWidth: 16, originalHeight: 12 })), cancel: vi.fn() };
  const manager = new JobManager(kernel, { load: async () => saved, save: async journal => { saved = structuredClone(journal); snapshots.push(saved); } }, compressor);
  const document: DocumentAssets = { id, title: "Current", notebooks: [], assets: [{ path, diskPath: "/data/" + path, name: "原图 %25.png", extension: ".png", size: 200, selected: true, blockers: [], references: [], referencesLoaded: false, order: 0 }] };
  return { manager, kernel, document, dom, files, post, snapshots, compressor, source: source.buffer,
    title: () => title, setTitle: (value: string) => { title = value; }, setTree: (value: SourceNode) => { tree = value; } };
}

it.each(["original", "webp"] as const)("saves a %s copy and updates only owned document references, then restores without scans", async format => {
  const s = setup(format), before = new Map([...s.dom].map(([key, value]) => [key, new DOMParser().parseFromString(value, "text/html").body.innerHTML])), title = s.title();
  const job = await s.manager.run(s.document, "compress", { ...DEFAULT_COMPRESSION, format }, undefined, "document");
  const item = job.items[0];
  expect(item).toMatchObject({ operation: "document-references", documentId: id, state: "completed" });
  expect(item.documentChanges).toHaveLength(3); expect(item.newPath).not.toBe(item.oldPath);
  expect(s.dom.get(block)).toContain(item.newPath + "?x=1#frag"); expect(s.dom.get(html)).toContain(item.newPath); expect(s.title()).toContain(item.newPath);
  expect(s.files.get(item.oldDiskPath)).toEqual(s.source);
  expect(s.post.mock.calls.some(([endpoint]) => /findAssetReferences|relinkAsset/.test(endpoint))).toBe(false);
  expect(s.post.mock.calls.filter(([endpoint]) => endpoint.endsWith("updateBlock")).map(([, body]) => body.id)).toEqual([block, html]);
  expect(s.snapshots.some(log => log.jobs[0].items[0].state === "applying" && log.jobs[0].items[0].documentChanges?.length === 3)).toBe(true);
  await s.manager.restore(job); expect(job.items[0].state).toBe("restored"); expect(s.dom).toEqual(before); expect(s.title()).toBe(title);
  expect(s.files.has(item.newDiskPath)).toBe(true);
});
it("skips database fields and foreign embeds without creating an output file", async () => {
  const s = setup(); s.dom.set(block, `<div data-node-id="${block}">No image</div>`); s.dom.delete(html); s.setTitle("");
  const job = await s.manager.run(s.document, "compress", { ...DEFAULT_COMPRESSION, format: "webp" }, undefined, "document");
  expect(job.items[0]).toMatchObject({ state: "skipped", error: "noDocumentReferences" }); expect(s.files.size).toBe(1);
  expect(s.post.mock.calls.some(([endpoint]) => /updateBlock|setBlockAttrs|findAssetReferences|relinkAsset/.test(endpoint))).toBe(false);
});
it("blocks restoration of a subsequently edited block", async () => {
  const s = setup(), job = await s.manager.run(s.document, "compress", { ...DEFAULT_COMPRESSION, format: "webp" }, undefined, "document");
  s.dom.set(block, s.dom.get(block)!.replace("attachment", "User edit"));
  await expect(s.manager.restore(job)).rejects.toThrow("restoreConflict"); expect(s.dom.get(block)).toContain("User edit"); expect(job.items[0].state).toBe("recovery-required");
});
it("rechecks a changed block before modifying any references", async () => {
  const s = setup(), put = s.kernel.putFile;
  s.kernel.putFile = async (path, bytes) => { await put(path, bytes); s.dom.set(block, s.dom.get(block)!.replace("attachment", "Concurrent edit")); };
  await expect(s.manager.run(s.document, "compress", { ...DEFAULT_COMPRESSION, format: "webp" }, undefined, "document")).rejects.toThrow("sourceChanged");
  expect(s.dom.get(block)).toContain("Concurrent edit"); expect(s.post.mock.calls.some(([endpoint]) => /updateBlock|setBlockAttrs/.test(endpoint))).toBe(false);
});
it("verifies and rolls back an unknown block write instead of replaying it", async () => {
  const s = setup(), post = s.kernel.post; let lost = false;
  s.kernel.post = async <T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> => {
    const result = await post<T>(endpoint, body, signal);
    if (endpoint.endsWith("updateBlock") && !lost) { lost = true; throw new Error("connection lost"); }
    return result;
  };
  const before = new Map(s.dom);
  await expect(s.manager.run(s.document, "compress", { ...DEFAULT_COMPRESSION, format: "webp" }, undefined, "document")).rejects.toThrow("connection lost");
  expect(s.manager.journal.jobs[0].items[0].state).toBe("restored"); expect(s.dom).toEqual(before); expect(s.compressor.compress).toHaveBeenCalledOnce();
});
it("recovers partial document updates after cancellation", async () => {
  const s = setup(), post = s.kernel.post, before = new Map(s.dom);
  s.kernel.post = async <T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> => { const result = await post<T>(endpoint, body, signal); if (endpoint.endsWith("updateBlock")) s.manager.cancel(); return result; };
  const job = await s.manager.run(s.document, "compress", { ...DEFAULT_COMPRESSION, format: "webp" }, undefined, "document");
  expect(job.state).toBe("interrupted"); expect(job.items[0].state).toBe("restored"); expect(s.dom).toEqual(before);
});

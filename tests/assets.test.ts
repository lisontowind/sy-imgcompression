// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { scanDocument, attachmentStats, documentStats } from "../src/core/assets";
import { Kernel } from "../src/types";
import { ref, report } from "./fixtures";

const book = "20261016000000-abcdefg", doc = "20261016000001-abcdefg";
function mockWorkspace(encrypted = false) {
  const directories: Record<string, unknown[]> = {
    "/data": [{ name: "assets", isDir: true }, { name: book, isDir: true }],
    "/data/assets": [{ name: "a.png", isDir: false }],
    [`/data/${book}`]: [{ name: "assets", isDir: true }, { name: doc + ".sy", isDir: false }],
    [`/data/${book}/assets`]: [{ name: "a.png", isDir: false }],
  };
  const post = vi.fn(async (endpoint: string, body: unknown) => {
    const input = body as { path: string };
    if (endpoint.endsWith("lsNotebooks")) return { notebooks: [{ id: book, name: "Closed", closed: true }] };
    if (endpoint.endsWith("getBlockInfo")) return { box: book, path: `/${doc}.sy` };
    if (endpoint.endsWith("getDocAssets")) return ["assets/a.png", "assets/a.png"];
    if (endpoint.endsWith("readDir")) { if (!(input.path in directories)) throw new Error("unreadable"); return directories[input.path]; }
    if (endpoint.endsWith("findAssetReferences")) return report([ref()]);
    if (endpoint.endsWith("statAsset")) return { size: 45 };
    if (endpoint.endsWith("resolveAssetPath")) return "/data/" + input.path;
    throw new Error("unexpected endpoint " + endpoint);
  });
  return { post, readFile: async (path: string) => new TextEncoder().encode(JSON.stringify(path.endsWith(".sy") ? {
    ID: doc, Type: "NodeDocument", Properties: { title: "Fixture" }, Children: [{ Type: "NodeLinkDest", Data: "assets/a.png" }],
  } : { encrypted })).buffer, putFile: vi.fn() } as unknown as Kernel;
}
it("resolves document attachments without walking closed notebooks or workspace directories", async () => {
  const kernel = mockWorkspace(); const result = await scanDocument(kernel, doc);
  expect(result.assets).toHaveLength(1); expect(result.assets[0]).toMatchObject({ diskPath: "/data/assets/a.png", selected: true, referencesLoaded: false });
  expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => endpoint.endsWith("readDir"))).toBe(false);
  expect(kernel.putFile).not.toHaveBeenCalled();
});
it("lists attachments and measures menu totals without workspace reference queries or writes", async () => {
  const kernel = mockWorkspace();
  const document = await scanDocument(kernel, doc);
  expect(document.assets[0]).toMatchObject({ references: [], referencesLoaded: false });
  expect(await documentStats(kernel, doc)).toEqual({ bytes: 45, count: 1, unknown: 0 });
  const endpoints = vi.mocked(kernel.post).mock.calls.map(([endpoint]) => endpoint);
  expect(endpoints.some(endpoint => /findAssetReferences|relinkAsset|getDocAssets/.test(endpoint))).toBe(false);
  expect(kernel.putFile).not.toHaveBeenCalled();
});
it("uses current document source even if the kernel asset cache contains stale entries", async () => {
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel);
  kernel.post = vi.fn(async (endpoint: string, body: unknown) => endpoint.endsWith("getDocAssets") ? ["assets/stale.png"] : post(endpoint, body)) as Kernel["post"];
  expect(await documentStats(kernel, doc)).toEqual({ bytes: 45, count: 1, unknown: 0 });
  expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => endpoint.endsWith("findAssetReferences"))).toBe(false);
});
it("browses an ordinary document without reading unrelated encrypted notebooks", async () => {
  const kernel = mockWorkspace(true);
  expect((await scanDocument(kernel, doc)).assets[0].selected).toBe(true);
  expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => /readDir|findAssetReferences|relinkAsset/.test(endpoint))).toBe(false);
});
it("stops native path resolution when cancelled during an in-flight request", async () => {
  const controller = new AbortController();
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel);
  kernel.post = vi.fn(async (endpoint: string, body: unknown) => {
    const result = await post(endpoint, body);
    if (endpoint.endsWith("resolveAssetPath")) controller.abort();
    return result;
  }) as Kernel["post"];
  await expect(scanDocument(kernel, doc, undefined, undefined, controller.signal)).rejects.toThrow("cancelled");
  expect(vi.mocked(kernel.post).mock.calls.filter(([endpoint]) => endpoint.endsWith("resolveAssetPath"))).toHaveLength(1);
});
it("does not swallow cancellation as an unknown attachment size or start more requests", async () => {
  const controller = new AbortController(); let finish!: (value: { size: number }) => void;
  const post = vi.fn(() => new Promise<{ size: number }>(resolve => { finish = resolve; }));
  const pending = attachmentStats({ post } as unknown as Kernel, ["assets/a.png"], controller.signal);
  controller.abort(); finish({ size: 45 });
  await expect(pending).rejects.toThrow("cancelled"); expect(post).toHaveBeenCalledTimes(1);
});
it("does not start document requests for an already cancelled scan", async () => {
  const kernel = mockWorkspace(), controller = new AbortController(); controller.abort();
  await expect(scanDocument(kernel, doc, undefined, undefined, controller.signal)).rejects.toThrow("cancelled");
  expect(kernel.post).not.toHaveBeenCalled();
});
it("accepts empty documents with missing children without scanning workspace directories", async () => {
  const kernel = mockWorkspace(true);
  kernel.readFile = async () => new TextEncoder().encode(JSON.stringify({ ID: doc, Type: "NodeDocument", Properties: { title: "Empty" } })).buffer;
  const result = await scanDocument(kernel, doc);
  expect(result.assets).toEqual([]); expect(result.stats).toEqual({ bytes: 0, count: 0, unknown: 0 });
  expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => endpoint.endsWith("readDir"))).toBe(false);
});
it("still rejects real document read failures and invalid document contexts", async () => {
  const kernel = mockWorkspace(); kernel.readFile = async () => { throw new Error("disk error"); };
  await expect(scanDocument(kernel, doc)).rejects.toThrow("readFailed");
  await expect(scanDocument(kernel, "")).rejects.toThrow("openDocument");
});
it("deduplicates attachment sizes and marks unavailable sizes as unknown", async () => {
  const kernel = { post: vi.fn(async (_endpoint: string, body: { path: string }) => {
    if (body.path === "assets/missing.pdf") throw new Error("missing");
    return { size: 50 };
  }) } as unknown as Kernel;
  const { stats } = await attachmentStats(kernel, ["assets/a.png", "assets/a.png", "assets/missing.pdf"]);
  expect(stats).toEqual({ bytes: 50, count: 2, unknown: 1 }); expect(kernel.post).toHaveBeenCalledTimes(2);
});
it("single-image scanning retains whole-document totals", async () => {
  const kernel = mockWorkspace();
  kernel.readFile = async path => new TextEncoder().encode(JSON.stringify(path.endsWith(".sy") ? {
    ID: doc, Type: "NodeDocument", Children: [{ Type: "NodeLinkDest", Data: "assets/a.png" }, { Type: "NodeLinkDest", Data: "assets/report.pdf" }],
  } : { encrypted: false })).buffer;
  const result = await scanDocument(kernel, doc, "assets/a.png");
  expect(result.assets).toHaveLength(1); expect(result.stats).toEqual({ bytes: 90, count: 2, unknown: 0 });
  expect(vi.mocked(kernel.post).mock.calls.filter(([endpoint]) => endpoint.endsWith("resolveAssetPath"))).toHaveLength(1);
});

it("does not download deferred assets just to build a list", async () => {
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel);
  kernel.post = vi.fn(async (endpoint, body) => endpoint.endsWith("statAsset") ? { size: 45, downloaded: false } : post(endpoint, body)) as Kernel["post"];
  const result = await scanDocument(kernel, doc);
  expect(result.stats).toEqual({ bytes: 45, count: 1, unknown: 0 });
  expect(result.assets[0]).toMatchObject({ sizeKnown: true, diskPath: "", selected: false, blockers: ["missingLocalAsset"] });
  expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => endpoint.endsWith("resolveAssetPath"))).toBe(false);
});
it("blocks unresolved paths or malformed resolver results without hiding other attachments", async () => {
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel);
  kernel.post = vi.fn(async (endpoint, body) => endpoint.endsWith("resolveAssetPath") ? "../outside.png" : post(endpoint, body)) as Kernel["post"];
  const result = await scanDocument(kernel, doc);
  expect(result.assets[0]).toMatchObject({ selected: false, diskPath: "", blockers: ["readFailed"] });
});
it("reports progress while metadata and paths are still loading", async () => {
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel), progress = vi.fn();
  kernel.post = vi.fn(async (endpoint, body) => {
    if (endpoint.endsWith("statAsset") || endpoint.endsWith("resolveAssetPath")) expect(progress).toHaveBeenCalledWith("assets/a.png");
    return post(endpoint, body);
  }) as Kernel["post"];
  await scanDocument(kernel, doc, undefined, progress);
  expect(progress).toHaveBeenCalled();
});
it("passes decoded filenames to the native resolver, preserving spaces, Unicode and percent signs", async () => {
  const kernel = mockWorkspace();
  kernel.readFile = async () => new TextEncoder().encode(JSON.stringify({ ID: doc, Type: "NodeDocument", Children: [{ Type: "NodeLinkDest", Data: "assets/中文%20%25.png" }] })).buffer;
  const result = await scanDocument(kernel, doc);
  expect(result.assets[0]).toMatchObject({ path: "assets/中文 %.png", diskPath: "/data/assets/中文 %.png", selected: true });
  expect(vi.mocked(kernel.post).mock.calls.find(([endpoint]) => endpoint.endsWith("resolveAssetPath"))?.[1]).toEqual({ path: "assets/中文 %.png" });
});
it("limits metadata and path resolution to six requests at a time for 118 attachments", async () => {
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel);
  kernel.readFile = async () => new TextEncoder().encode(JSON.stringify({ ID: doc, Type: "NodeDocument", Children: Array.from({ length: 118 }, (_, i) => ({ Type: "NodeLinkDest", Data: `assets/${i}.png` })) })).buffer;
  let active = 0, maximum = 0;
  kernel.post = vi.fn(async (endpoint, body) => {
    if (!/statAsset|resolveAssetPath/.test(endpoint)) return post(endpoint, body);
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 0)); active--;
    return endpoint.endsWith("statAsset") ? { size: 45 } : "/data/" + (body as { path: string }).path;
  }) as Kernel["post"];
  const result = await scanDocument(kernel, doc);
  expect(result.assets).toHaveLength(118); expect(result.assets.every(asset => asset.selected)).toBe(true);
  expect(maximum).toBe(6);
  expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => endpoint.endsWith("readDir"))).toBe(false);
});
it("shares concurrent menu totals but rechecks when a later menu is opened", async () => {
  const kernel = mockWorkspace(); const read = vi.spyOn(kernel, "readFile");
  const [first, second] = await Promise.all([documentStats(kernel, doc), documentStats(kernel, doc)]);
  expect(first).toEqual(second); expect(read).toHaveBeenCalledOnce();
  await documentStats(kernel, doc); expect(read).toHaveBeenCalledTimes(2);
});
it("single-image quick operations do not stat unrelated attachments", async () => {
  const kernel = mockWorkspace();
  kernel.readFile = async () => new TextEncoder().encode(JSON.stringify({ ID: doc, Type: "NodeDocument", Children: Array.from({ length: 118 }, (_, i) => ({ Type: "NodeLinkDest", Data: `assets/${i}.png` })) })).buffer;
  const result = await scanDocument(kernel, doc, "assets/0.png", undefined, undefined, false);
  expect(result.assets).toHaveLength(1);
  expect(vi.mocked(kernel.post).mock.calls.filter(([endpoint]) => endpoint.endsWith("statAsset"))).toHaveLength(1);
});

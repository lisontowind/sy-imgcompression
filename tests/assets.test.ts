// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { scanDocument, inventoryAssets, attachmentStats } from "../src/core/assets";
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
    throw new Error("unexpected endpoint " + endpoint);
  });
  return { post, readFile: async (path: string) => new TextEncoder().encode(JSON.stringify(path.endsWith(".sy") ? {
    ID: doc, Type: "NodeDocument", Properties: { title: "Fixture" }, Children: [{ Type: "NodeLinkDest", Data: "assets/a.png" }],
  } : { encrypted })).buffer, putFile: vi.fn() } as unknown as Kernel;
}
it("detects ambiguous resource paths across closed notebooks instead of merging files", async () => {
  const kernel = mockWorkspace(); const result = await scanDocument(kernel, doc);
  expect(result.assets).toHaveLength(1); expect(result.assets[0].blockers).toContain("ambiguousAsset");
  expect(result.assets[0].selected).toBe(false); expect(kernel.putFile).not.toHaveBeenCalled();
});
it("does not silently skip encrypted notebooks in filesystem inventory", async () => {
  await expect(inventoryAssets(mockWorkspace(true), new Set(["assets/a.png"]))).rejects.toThrow("incompleteScan");
});
it("accepts null/empty asset lists and missing children without scanning workspace directories", async () => {
  for (const all of [null, []]) {
    const kernel = mockWorkspace(true), post = kernel.post.bind(kernel);
    kernel.post = vi.fn(async (endpoint: string, body: unknown) => endpoint.endsWith("getDocAssets") ? all : post(endpoint, body)) as Kernel["post"];
    kernel.readFile = async () => new TextEncoder().encode(JSON.stringify({ ID: doc, Type: "NodeDocument", Properties: { title: "Empty" } })).buffer;
    const result = await scanDocument(kernel, doc);
    expect(result.assets).toEqual([]); expect(result.stats).toEqual({ bytes: 0, count: 0, unknown: 0 });
    expect(vi.mocked(kernel.post).mock.calls.some(([endpoint]) => endpoint.endsWith("readDir"))).toBe(false);
  }
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
  const kernel = mockWorkspace(), post = kernel.post.bind(kernel);
  kernel.post = vi.fn(async (endpoint: string, body: unknown) => endpoint.endsWith("getDocAssets") ? ["assets/a.png", "assets/report.pdf"] : post(endpoint, body)) as Kernel["post"];
  kernel.readFile = async path => new TextEncoder().encode(JSON.stringify(path.endsWith(".sy") ? {
    ID: doc, Type: "NodeDocument", Children: [{ Type: "NodeLinkDest", Data: "assets/a.png" }, { Type: "NodeLinkDest", Data: "assets/report.pdf" }],
  } : { encrypted: false })).buffer;
  const result = await scanDocument(kernel, doc, "assets/a.png");
  expect(result.assets).toHaveLength(1); expect(result.stats).toEqual({ bytes: 90, count: 2, unknown: 0 });
});

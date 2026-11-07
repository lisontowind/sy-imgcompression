// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { databaseSourcePaths, databaseViewPaths } from "../src/core/database-order";
import { Kernel } from "../src/types";

it("stops database pagination immediately after cancellation", async () => {
  const controller = new AbortController();
  const post = vi.fn(async () => { controller.abort(); return { view: { rowCount: 2, rows: [{ id: "a", cells: [] }] } }; });
  const block = '<div data-type="NodeAttributeView" data-av-id="20261016000000-abcdefg"></div>';
  await expect(databaseViewPaths({ post } as unknown as Kernel, block, controller.signal)).rejects.toThrow("cancelled");
  expect(post).toHaveBeenCalledTimes(1);
});

it("uses rendered database row order, pagination and mirror deduplication", async () => {
  const post = vi.fn().mockResolvedValueOnce({ view: { rowCount: 3, rows: [
    { id: "b", cells: [{ value: { mAsset: [{ content: "assets/b.png" }] } }] },
    { id: "a", cells: [{ value: { mAsset: [{ content: "assets/a.png" }] } }] },
  ] } }).mockResolvedValueOnce({ view: { rowCount: 3, rows: [{ id: "c", cells: [{ value: { url: { content: "assets/c.pdf#page=2" } } }] }] } });
  const kernel = { post } as unknown as Kernel;
  const block = '<div data-type="NodeAttributeView" data-av-id="20261016000000-abcdefg"></div>';
  expect(await databaseViewPaths(kernel, block + block)).toEqual(["assets/b.png", "assets/a.png", "assets/c.pdf"]);
  expect(post).toHaveBeenCalledTimes(2); expect(post.mock.calls[1][1].page).toBe(2);
});

it("walks grouped gallery cards without treating missing definitions as empty", async () => {
  const kernel = { post: vi.fn().mockResolvedValueOnce({ view: { groups: [{ cards: [{ id: "a", values: [{ value: { mAsset: [{ content: "assets/a.webp" }] } }] }] }] } }).mockResolvedValueOnce({ view: { groups: [] } }) } as unknown as Kernel;
  const block = '<div data-type="NodeAttributeView" data-av-id="20261016000000-abcdefg"></div>';
  expect(await databaseViewPaths(kernel, block)).toEqual(["assets/a.webp"]);
  await expect(databaseViewPaths({ post: async () => null } as unknown as Kernel, block)).rejects.toThrow("unavailableDatabase");
});
it("reads hidden database assets, nested values and rich text without workspace queries", async () => {
  const id = "20261016000000-abcdefg";
  const readFile = vi.fn(async () => new TextEncoder().encode(JSON.stringify({ id, keyValues: [{ values: [
    { mAsset: [{ content: "assets/hidden.png" }] },
    { rollup: { contents: [{ url: { content: "assets/hidden.pdf#page=2" } }] } },
    { text: { content: "assets/ordinary-text.png", rich: { spec: 1, format: "kramdown", content: "[link](assets/rich.png)" } } },
  ] }] })).buffer);
  const post = vi.fn(async () => ({ html: '<a href="assets/rich.png">link</a>' }));
  expect(await databaseSourcePaths({ readFile, post } as unknown as Kernel, new Set([id]))).toEqual(["assets/hidden.png", "assets/hidden.pdf", "assets/rich.png"]);
  expect(readFile).toHaveBeenCalledWith(`/data/storage/av/${id}.json`, undefined);
  expect(post).toHaveBeenCalledExactlyOnceWith("/api/lute/md2html", { markdown: "[link](assets/rich.png)" }, undefined);
});
it("rejects missing database sources and preserves cancellation", async () => {
  const id = "20261016000000-abcdefg", controller = new AbortController();
  const kernel = { readFile: vi.fn(async () => { throw new Error("unreadable"); }) } as unknown as Kernel;
  await expect(databaseSourcePaths(kernel, new Set([id]))).rejects.toThrow("unavailableDatabase");
  controller.abort();
  await expect(databaseSourcePaths(kernel, new Set([id]), controller.signal)).rejects.toThrow("cancelled");
});

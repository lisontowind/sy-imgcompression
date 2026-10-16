// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { databaseViewPaths } from "../src/core/database-order";
import { Kernel } from "../src/types";

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

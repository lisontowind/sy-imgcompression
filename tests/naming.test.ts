import { describe, expect, it } from "vitest";
import { documentPrefix, fullRename, imageRename, newNodeId, sequenceName, truncateUTF8, utf8Length, validateFilename } from "../src/core/naming";
import { assignRenamePaths } from "../src/core/jobs";
import { AssetIdentity } from "../src/types";

describe("UTF-8 document prefixes", () => {
  it("keeps eight common Chinese characters within the default 24 bytes", () => {
    expect(documentPrefix("项目实施方案验收记录")).toBe("项目实施方案验收");
    expect(utf8Length(documentPrefix("项目实施方案验收记录"))).toBe(24);
    expect(sequenceName("项目实施方案验收记录", 1)).toBe("项目实施方案验收-001");
  });
  it("keeps sixteen English characters by default", () => {
    expect(documentPrefix("abcdefghijklmnopqrst")).toBe("abcdefghijklmnop");
    expect(sequenceName("abcdefghijklmnopqrst", 1)).toBe("abcdefghijklmnop-001");
    expect(fullRename("abcdefghijklmnopqrst", 1, ".pdf", 24, "20261016010101-abc1234"))
      .toBe("abcdefghijklmnop-001-20261016010101-abc1234.pdf");
  });
  it("shares the prefix budget proportionally between English and Chinese", () => {
    expect(documentPrefix("ABCDEFGH中文测试记录")).toBe("ABCDEFGH中文测试");
    expect(documentPrefix("中文测试ABCDEFGHijkl")).toBe("中文测试ABCDEFGH");
    expect(documentPrefix("ABC中文", 7)).toBe("ABC");
    expect(documentPrefix("abcdefghijklmnop", 12)).toBe("abcdefgh");
    expect(documentPrefix("项目实施方案", 12)).toBe("项目实施");
  });
  it("normalizes combining accents and does not split emoji graphemes", () => {
    expect(documentPrefix("e\u0301clair", 2)).toBe("é");
    expect(truncateUTF8("a👩‍💻b", 10)).toBe("a");
    expect(truncateUTF8("a👩‍💻b", 12)).toBe("a👩‍💻");
    expect(documentPrefix("a👩‍💻b", 12)).toBe("a");
    expect(documentPrefix("a👩‍💻b", 13)).toBe("a👩‍💻");
    expect(documentPrefix("👩‍💻", 1)).toBe("d");
    for (let budget = 1; budget <= 120; budget++) {
      expect(utf8Length(documentPrefix("abc中文👩‍💻e\u0301".repeat(20), budget))).toBeLessThanOrEqual(budget);
    }
  });
  it("sanitizes separators, controls, trailing dots and reserved names", () => {
    expect(documentPrefix('  a/:*?"<>|b\u0000.  ')).toBe("a-b");
    expect(documentPrefix("CON")).toBe("_CON");
    expect(documentPrefix("CONnect", 5)).toBe("_CO");
    expect(documentPrefix("...", 4)).toBe("do");
  });
  it("rejects invalid budgets and handles four-digit sequence numbers", () => {
    for (const budget of [0, 121, 2.5, NaN]) expect(() => documentPrefix("title", budget)).toThrow();
    expect(sequenceName("a", 1000)).toBe("a-1000");
    expect(() => sequenceName("a", 0)).toThrow();
  });
  it("retains extensions and generates valid unique node IDs", () => {
    const name = fullRename("项目", 1, ".pdf", 24, "20261016010101-abc1234");
    expect(name).toBe("项目-001-20261016010101-abc1234.pdf");
    expect(new Set(Array.from({ length: 200 }, () => newNodeId())).size).toBe(200);
    expect(newNodeId()).toMatch(/^\d{14}-[a-z0-9]{7}$/);
    expect(() => validateFilename("a".repeat(241))).toThrow();
    expect(() => validateFilename("NUL.txt")).toThrow();
  });
  it("keeps image rename previews stable across selection changes", () => {
    const assets = ["a", "b", "c"].map(path => ({ path, extension: ".png", selected: true, blockers: [] })) as unknown as AssetIdentity[];
    assignRenamePaths(assets, "Title", { documentNameMaxBytes: 24 });
    const id = assets[2].newPath!.slice(-26); assets[1].selected = false;
    assignRenamePaths(assets, "Title", { documentNameMaxBytes: 24 });
    expect(assets[1].newPath).toMatch(/assets\/image-/); expect(assets[2].newPath!.endsWith(id)).toBe(true);
  });
  it("retains only complete terminal native IDs and preserves extensions", () => {
    expect(imageRename("prefix-foo-20261016010101-abc1234.PNG", ".PNG")).toBe("image-20261016010101-abc1234.PNG");
    expect(imageRename("image-20261016010101-abc1234.png", ".png")).toBe("image-20261016010101-abc1234.png");
    expect(imageRename("foo20261016010101-abc1234.png", ".png", "20261016020202-new1234")).toBe("image-20261016020202-new1234.png");
    expect(imageRename("a.png", ".png")).toMatch(/^image-\d{14}-[a-z0-9]{7}\.png$/);
  });
  it("does not assign names to non-image attachments", () => {
    const assets = [{ path: "assets/a.pdf", name: "a.pdf", extension: ".pdf", selected: true, blockers: [] }] as unknown as AssetIdentity[];
    assignRenamePaths(assets, "Title", { documentNameMaxBytes: 24 }); expect(assets[0].newPath).toBeUndefined();
  });
  it("combines custom batch prefixes and per-image names without changing native IDs", () => {
    const assets = ["a", "b"].map((name, index) => ({ path: `assets/${name}-20261016010101-abc123${index}.png`, name: `${name}-20261016010101-abc123${index}.png`, extension: ".png", blockers: [], selected: true })) as unknown as AssetIdentity[];
    assets[0].renameStem = "封面";
    assignRenamePaths(assets, "Title", { documentNameMaxBytes: 24, prefix: "旅行" });
    expect(assets.map(asset => asset.newPath)).toEqual(["assets/封面-20261016010101-abc1230.png", "assets/旅行-20261016010101-abc1231.png"]);
    assignRenamePaths(assets, "Title", { documentNameMaxBytes: 24, prefix: "照片" });
    expect(assets[0].newPath).toBe("assets/封面-20261016010101-abc1230.png"); expect(assets[1].newPath).toBe("assets/照片-20261016010101-abc1231.png");
    assets[0].renameStem = undefined; assignRenamePaths(assets, "Title", { documentNameMaxBytes: 24, prefix: "照片" });
    expect(assets[0].newPath).toBe("assets/照片-20261016010101-abc1230.png");
  });
  it("rejects invalid or oversized custom names", () => {
    for (const name of ["../bad", "bad/name", "CON", "bad:name", "图".repeat(90)]) expect(() => imageRename("a.png", ".png", "20261016010101-abc1234", name)).toThrow("invalidFilename");
    expect(imageRename("a.png", ".png", "20261016010101-abc1234", "  e\u0301cran  ")).toBe("écran-20261016010101-abc1234.png");
  });
});

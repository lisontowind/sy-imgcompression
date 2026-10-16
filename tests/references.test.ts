// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { assertComplete, assertNoUnexpectedReferences, expectedAfter, referenceFingerprint } from "../src/core/references";
import { normalizeAssetURL, requestPath, rewriteReference } from "../src/core/paths";
import { orderedPaths } from "../src/core/assets";
import { ref, report } from "./fixtures";
describe("structural reference safety", () => {
  it("handles encoded paths and rejects escapes and external URLs", () => {
    expect(normalizeAssetURL("/assets/%E4%B8%AD%20%E6%96%87.png?x=1#part")).toBe("assets/中 文.png");
    expect(normalizeAssetURL("https://example.com/assets/a.png")).toBeUndefined();
    expect(() => normalizeAssetURL("assets/%2e%2e/a.png")).toThrow();
    expect(() => normalizeAssetURL("assets/a\\b.png")).toThrow();
    expect(requestPath("assets/中 %.png")).toBe("assets/%E4%B8%AD%20%25.png");
    expect(rewriteReference("/assets/a.png?box=abc#frag", "assets/新图.webp", "link")).toBe("/assets/%E6%96%B0%E5%9B%BE.webp?box=abc#frag");
  });
  it("puts title images first, includes offscreen BlockDOM, and deduplicates", () => {
    expect(orderedPaths('<div hidden><img src="assets/b.png"></div><a href="assets/a.pdf">x</a><img src="assets/b.png">', 'background-image:url("assets/title.png")', ["assets/db.png", "assets/b.png"]))
      .toEqual(["assets/title.png", "assets/b.png", "assets/a.pdf", "assets/db.png"]);
  });
  it("does not treat unreadable or skipped notebooks as no references", () => {
    expect(() => assertComplete({ ...report(), skippedNotebooks: ["locked"] })).toThrow("incompleteScan");
    expect(() => assertComplete({ ...report(), unavailableAttributeViews: [{ avID: "missing", notebook: "closed", reason: "missing_definition" }] })).toThrow("unavailableDatabase");
    expect(() => assertComplete(report([{ ...ref(), relinkable: false, reason: "unknown" }]))).toThrow("unsupportedReference");
  });
  it("fingerprints locations and values, ignoring order but retaining repeated occurrences", () => {
    expect(referenceFingerprint([ref("a"), ref("b")])).toBe(referenceFingerprint([ref("b"), ref("a")]));
    expect(referenceFingerprint([ref("a"), ref("a")])).not.toBe(referenceFingerprint([ref("a")]));
    expect(referenceFingerprint([ref("a")])).not.toBe(referenceFingerprint([ref("b")]));
  });
  it("allows restoring only the original reference set, not newly added references", () => {
    const planned = expectedAfter([{ ...ref(), replacement: "assets/b.webp" }], "assets/a.png", "assets/b.webp");
    expect(planned[0].reference).toBe("assets/b.webp");
    expect(() => assertNoUnexpectedReferences(planned, planned)).not.toThrow();
    expect(() => assertNoUnexpectedReferences([...planned, { ...planned[0], blockID: "new" }], planned)).toThrow("restoreConflict");
    expect(() => assertNoUnexpectedReferences([...planned, planned[0]], planned)).toThrow("restoreConflict");
  });
});

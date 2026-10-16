import { describe, expect, it } from "vitest";
import { fitDimensions, outputDimensions, inspectImage, validateCompression } from "../src/compression/image-info";
import { png } from "./fixtures";
describe("image validation before allocation", () => {
  it("reads PNG dimensions and rejects APNG", () => {
    expect(inspectImage(png())).toMatchObject({ format: "png", width: 16, height: 12 });
    expect(() => inspectImage(png(16, 12, true))).toThrow("animatedImage");
  });
  it("rejects oversized, truncated and unsupported inputs", () => {
    expect(() => inspectImage(png(10000, 10000))).toThrow("imageTooLarge");
    expect(() => inspectImage(png().slice(0, 25))).toThrow("damagedImage");
    expect(() => inspectImage(new TextEncoder().encode("GIF89a").buffer)).toThrow("animatedImage");
    expect(() => inspectImage(new TextEncoder().encode("<svg/>").buffer)).toThrow("unsupportedImage");
  });
  it("detects animated WebP before decoding", () => {
    const b = new Uint8Array(30), d = new DataView(b.buffer); b.set(new TextEncoder().encode("RIFF")); d.setUint32(4, 22, true);
    b.set(new TextEncoder().encode("WEBPVP8X"), 8); d.setUint32(16, 10, true); b[20] = 2;
    expect(() => inspectImage(b.buffer)).toThrow("animatedImage");
    b[20] = 0; b[24] = 15; b[27] = 11;
    expect(inspectImage(b.buffer)).toMatchObject({ width: 16, height: 12 });
  });
  it("preserves aspect ratio and never enlarges", () => {
    expect(fitDimensions(4000, 2000, 1000, 900)).toEqual([1000, 500]);
    expect(fitDimensions(100, 50, 1000, 1000)).toEqual([100, 50]);
    expect(fitDimensions(100, 50, 0, 25)).toEqual([50, 25]);
    expect(fitDimensions(100, 50, 0, 0)).toEqual([100, 50]);
  });
  it("rejects invalid compression parameters", () => {
    expect(() => validateCompression({ quality: 101, maxWidth: 0, maxHeight: 0, format: "webp" })).toThrow();
    expect(() => validateCompression({ quality: 82, maxWidth: NaN, maxHeight: 0, format: "webp" })).toThrow();
  });
  it("handles percentage, axis and longest-edge sizing with no enlargement", () => {
    const options = { quality: 82, format: "webp" as const, maxWidth: 0, maxHeight: 0 };
    expect(outputDimensions(4000, 2000, { ...options, resize: { mode: "percent", value: 75 } })).toEqual([3000, 1500]);
    expect(outputDimensions(2000, 4000, { ...options, resize: { mode: "longestEdge", value: 1000 } })).toEqual([500, 1000]);
    expect(outputDimensions(4000, 2000, { ...options, resize: { mode: "height", value: 1000 } })).toEqual([2000, 1000]);
    expect(outputDimensions(20, 10, { ...options, resize: { mode: "width", value: 1000 } })).toEqual([20, 10]);
    expect(outputDimensions(1, 2, { ...options, resize: { mode: "percent", value: 1 } })).toEqual([1, 1]);
    for (const value of [0, 101, NaN, 1.5]) expect(() => validateCompression({ ...options, resize: { mode: "percent", value } })).toThrow("invalidCompression");
  });
});

import { CompressionOptions, UserError } from "../types";
export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export interface ImageInfo { format: "jpeg" | "png" | "webp"; mime: string; width: number; height: number }

export function inspectImage(buffer: ArrayBuffer): ImageInfo {
  const b = new Uint8Array(buffer), d = new DataView(buffer);
  if (b.length > MAX_BYTES) throw new UserError("imageTooLarge");
  const text = (offset: number, count: number) => String.fromCharCode(...b.subarray(offset, offset + count));
  let width = 0, height = 0, format: ImageInfo["format"];
  if (b.length >= 24 && text(0, 8) === "\x89PNG\r\n\x1a\n") {
    format = "png";
    if (text(12, 4) !== "IHDR") throw new UserError("damagedImage");
    width = d.getUint32(16); height = d.getUint32(20);
    for (let offset = 8; offset + 12 <= b.length;) {
      const length = d.getUint32(offset), type = text(offset + 4, 4);
      if (offset + 12 + length > b.length) throw new UserError("damagedImage");
      if (type === "acTL") throw new UserError("animatedImage");
      offset += length + 12;
    }
  } else if (b.length >= 12 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    format = "webp";
    if (d.getUint32(4, true) + 8 > b.length) throw new UserError("damagedImage");
    for (let offset = 12; offset + 8 <= b.length;) {
      const type = text(offset, 4), length = d.getUint32(offset + 4, true), p = offset + 8;
      if (p + length > b.length) throw new UserError("damagedImage");
      if (type === "ANIM" || type === "ANMF" || (type === "VP8X" && (b[p] & 2))) throw new UserError("animatedImage");
      if (type === "VP8X" && length >= 10) {
        width = 1 + b[p + 4] + (b[p + 5] << 8) + (b[p + 6] << 16);
        height = 1 + b[p + 7] + (b[p + 8] << 8) + (b[p + 9] << 16);
      } else if (!width && type === "VP8 " && length >= 10 && text(p + 3, 3) === "\x9d\x01\x2a") {
        width = d.getUint16(p + 6, true) & 0x3fff; height = d.getUint16(p + 8, true) & 0x3fff;
      } else if (!width && type === "VP8L" && length >= 5 && b[p] === 0x2f) {
        const bits = d.getUint32(p + 1, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset = p + length + (length & 1);
    }
  } else if (b.length > 4 && b[0] === 255 && b[1] === 216) {
    format = "jpeg";
    for (let offset = 2; offset < b.length;) {
      if (b[offset++] !== 255) throw new UserError("damagedImage");
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > b.length) throw new UserError("damagedImage");
      const size = d.getUint16(offset);
      if (size < 2 || offset + size > b.length) throw new UserError("damagedImage");
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8) throw new UserError("damagedImage");
        height = d.getUint16(offset + 3); width = d.getUint16(offset + 5);
      }
      offset += size;
    }
  } else {
    if (text(0, 3) === "GIF") throw new UserError("animatedImage");
    throw new UserError("unsupportedImage");
  }
  if (!width || !height) throw new UserError("damagedImage");
  if (width * height > MAX_PIXELS) throw new UserError("imageTooLarge");
  return { format, mime: `image/${format}`, width, height };
}

export function validateCompression(options: CompressionOptions): void {
  if (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100 || !["webp", "original"].includes(options.format)
    || [options.maxWidth, options.maxHeight].some(n => !Number.isInteger(n) || n < 0 || n > 100000)) throw new UserError("invalidCompression");
  if (options.resize) {
    const { mode, value } = options.resize;
    if (!["original", "percent", "width", "height", "longestEdge"].includes(mode)
        || !Number.isInteger(value) || value < 1 || value > (mode === "percent" ? 100 : 100000)) throw new UserError("invalidCompression");
  }
}
export function outputDimensions(width: number, height: number, options: CompressionOptions): [number, number] {
  const resize = options.resize;
  if (!resize) return fitDimensions(width, height, options.maxWidth, options.maxHeight);
  if (resize.mode === "original") return [width, height];
  if (resize.mode === "percent") return [Math.max(1, Math.floor(width * resize.value / 100)), Math.max(1, Math.floor(height * resize.value / 100))];
  if (resize.mode === "width") return fitDimensions(width, height, resize.value, 0);
  if (resize.mode === "height") return fitDimensions(width, height, 0, resize.value);
  return fitDimensions(width, height, resize.value, resize.value);
}
export function fitDimensions(width: number, height: number, maxWidth: number, maxHeight: number): [number, number] {
  const ratio = Math.min(1, maxWidth > 0 ? maxWidth / width : 1, maxHeight > 0 ? maxHeight / height : 1);
  return [Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio))];
}

import encodeWebp from "@jsquash/webp/encode.js";
import encodeJpeg from "@jsquash/jpeg/encode.js";
import encodePng from "@jsquash/png/encode.js";
import initOxipng, { optimise } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import resize from "@jsquash/resize";
import { CompressionOptions, CompressionResult, UserError } from "../types";
import { outputDimensions, inspectImage, validateCompression } from "./image-info";

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; options: CompressionOptions }>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const { bytes, options } = event.data;
    validateCompression(options);
    const info = inspectImage(bytes);
    const target = outputDimensions(info.width, info.height, options);
    const noResize = target[0] === info.width && target[1] === info.height;
    if (info.format === "png" && options.format === "original" && noResize) {
      // Optimise original PNG bytes directly: preserve bit depth, colour profiles and pixels.
      await initOxipng();
      const result = optimise(new Uint8Array(bytes), 2, false, false);
      const output: CompressionResult = { bytes: result.slice().buffer as ArrayBuffer, mime: "image/png", extension: ".png",
        width: info.width, height: info.height, originalWidth: info.width, originalHeight: info.height };
      self.postMessage({ result: output }, [output.bytes]); return;
    }
    bitmap = await createImageBitmap(new Blob([bytes], { type: info.mime }), { imageOrientation: "from-image", colorSpaceConversion: "default" });
    const originalWidth = bitmap.width, originalHeight = bitmap.height;
    const canvas = new OffscreenCanvas(originalWidth, originalHeight);
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new UserError("unsupportedWorker");
    context.drawImage(bitmap, 0, 0); bitmap.close(); bitmap = undefined;
    let pixels = context.getImageData(0, 0, originalWidth, originalHeight);
    canvas.width = canvas.height = 1;
    const [width, height] = outputDimensions(originalWidth, originalHeight, options);
    if (width !== originalWidth || height !== originalHeight) pixels = await resize(pixels, { width, height, method: "lanczos3", premultiply: true, linearRGB: true });
    const format = options.format === "webp" ? "webp" : info.format;
    let encoded: ArrayBuffer;
    if (format === "webp") encoded = await encodeWebp(pixels, { quality: options.quality, alpha_quality: 100, method: 4 });
    else if (format === "jpeg") encoded = await encodeJpeg(pixels, { quality: options.quality });
    else { await initOxipng(); encoded = optimise(new Uint8Array(await encodePng(pixels)), 2, false, false).slice().buffer as ArrayBuffer; }
    inspectImage(encoded);
    const result: CompressionResult = { bytes: encoded, mime: `image/${format}`, extension: format === "jpeg" ? ".jpg" : "." + format,
      width, height, originalWidth, originalHeight };
    self.postMessage({ result }, [encoded]);
  } catch (error) {
    self.postMessage({ error: error instanceof UserError ? error.code : "damagedImage", detail: String(error) });
  } finally { bitmap?.close(); }
};

import { CompressionOptions, CompressionResult, UserError } from "../types";
import { inspectImage, validateCompression } from "./image-info";

export class CompressionClient {
  private worker?: Worker;
  private reject?: (reason: unknown) => void;
  async compress(bytes: ArrayBuffer, options: CompressionOptions): Promise<CompressionResult> {
    if (this.worker) throw new UserError("busy");
    inspectImage(bytes); validateCompression(options);
    const worker = new Worker("/plugins/sy-imgcompression/compression.worker.js", { name: "sy-imgcompression" });
    this.worker = worker;
    try {
      return await new Promise<CompressionResult>((resolve, reject) => {
        this.reject = reject;
        const timer = setTimeout(() => reject(new UserError("compressionTimeout")), 120_000);
        worker.onmessage = event => {
          clearTimeout(timer);
          if (event.data.error) reject(new UserError(event.data.error, event.data.detail)); else resolve(event.data.result);
        };
        worker.onerror = event => { clearTimeout(timer); reject(new UserError("unsupportedWorker", event.message)); };
        const originalReject = this.reject;
        this.reject = reason => { clearTimeout(timer); originalReject?.(reason); };
        worker.postMessage({ bytes, options }, [bytes]);
      });
    } finally { worker.terminate(); this.worker = undefined; this.reject = undefined; }
  }
  cancel(): void { this.reject?.(new UserError("cancelled")); this.worker?.terminate(); }
}

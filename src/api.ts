import { DirectoryEntry, Kernel, UserError } from "./types";
import { checkCancelled } from "./core/cancellation";
import { ReadPool } from "./core/read-pool";

const sharedReads = new Set(["/api/asset/statAsset", "/api/asset/resolveAssetPath", "/api/notebook/lsNotebooks", "/api/block/getBlockInfo", "/api/block/getDocInfo", "/api/lute/md2html"]);

export class KernelError extends Error {
  constructor(public endpoint: string, public data: unknown, message: string, public outcomeUnknown = false) { super(message); }
}
export class SiYuanKernel implements Kernel {
  private reads = new ReadPool();
  cancelReads(): void { this.reads.cancel(); }
  async post<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (sharedReads.has(endpoint)) return this.reads.run(endpoint + ":" + JSON.stringify(body), current => this.request<T>(endpoint, body, current), signal);
    return this.request<T>(endpoint, body, signal);
  }
  private async request<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> {
    checkCancelled(signal);
    let response: Response;
    try { response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch (error) { checkCancelled(signal); throw new KernelError(endpoint, undefined, String(error), true); }
    if (!response.ok) throw new KernelError(endpoint, undefined, `${response.status}: ${endpoint}`, true);
    let result: { code: number; msg: string; data: T };
    try { result = await response.json(); }
    catch { checkCancelled(signal); throw new KernelError(endpoint, undefined, "Invalid kernel response", true); }
    checkCancelled(signal);
    if (result.code !== 0) throw new KernelError(endpoint, result.data, result.msg || `Kernel error ${result.code}`);
    return result.data;
  }
  private async fileResponse(path: string, signal?: AbortSignal): Promise<Response> {
    checkCancelled(signal);
    try {
      const response = await fetch("/api/file/getFile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }), signal });
      checkCancelled(signal); return response;
    } catch (error) { checkCancelled(signal); throw error; }
  }
  async fileExists(path: string): Promise<boolean> {
    const response = await this.fileResponse(path);
    if (response.status === 200) {
      // An existing target is a conflict; its contents are not needed.
      await response.body?.cancel(); return true;
    }
    if (response.status === 404) return false;
    if (response.status === 409) return true;
    // Binary API errors use HTTP 202 with the actual error code in JSON.
    // Only an explicit missing-file result permits creating a new target.
    if (response.status === 202) {
      const result = await response.json();
      if (result.code === 404) return false;
      if (result.code === 409) return true;
    }
    throw new UserError("readFailed", path);
  }
  async readOptionalJSON<T>(path: string): Promise<T | undefined> {
    const response = await this.fileResponse(path);
    // Only the kernel's explicit missing-file status represents an empty store.
    // Network errors and invalid JSON must not fall back to a cached journal.
    if (response.status === 404) return undefined;
    if (response.status === 202) {
      try { if ((await response.json()).code === 404) return undefined; }
      catch { throw new UserError("readFailed", path); }
      throw new UserError("readFailed", path);
    }
    if (response.status !== 200) throw new UserError("readFailed", path);
    return response.json();
  }
  async readFile(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const response = await this.fileResponse(path, signal);
    if (response.status !== 200) throw new UserError("readFailed", path);
    try { const bytes = await response.arrayBuffer(); checkCancelled(signal); return bytes; }
    catch (error) { checkCancelled(signal); throw error; }
  }
  async putFile(path: string, bytes: ArrayBuffer): Promise<void> {
    const body = new FormData(); body.append("path", path); body.append("isDir", "false");
    body.append("file", new Blob([bytes]), path.split("/").pop());
    let response: Response;
    try { response = await fetch("/api/file/putFile", { method: "POST", body }); }
    catch (error) { throw new KernelError("/api/file/putFile", undefined, String(error), true); }
    if (!response.ok) throw new KernelError("/api/file/putFile", undefined, `${response.status}`, true);
    const result = await response.json();
    if (result.code !== 0) throw new KernelError("/api/file/putFile", result.data, result.msg);
  }
}

export async function readJSON<T>(kernel: Kernel, path: string, signal?: AbortSignal): Promise<T> {
  checkCancelled(signal);
  try {
    const bytes = await kernel.readFile(path, signal); checkCancelled(signal);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) { checkCancelled(signal); throw new UserError("readFailed", `${path}: ${String(e)}`); }
}
export async function fileExists(kernel: Kernel, path: string): Promise<boolean> {
  if (kernel.fileExists) return kernel.fileExists(path);
  const slash = path.lastIndexOf("/");
  const entries = await kernel.post<DirectoryEntry[]>("/api/file/readDir", { path: path.slice(0, slash) });
  return entries.some(entry => entry.name.toLocaleLowerCase("en-US") === path.slice(slash + 1).toLocaleLowerCase("en-US"));
}

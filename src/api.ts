import { DirectoryEntry, Kernel, UserError } from "./types";

export class KernelError extends Error {
  constructor(public endpoint: string, public data: unknown, message: string, public outcomeUnknown = false) { super(message); }
}
export class SiYuanKernel implements Kernel {
  async post<T>(endpoint: string, body: unknown): Promise<T> {
    let response: Response;
    try { response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch (error) { throw new KernelError(endpoint, undefined, String(error), true); }
    if (!response.ok) throw new KernelError(endpoint, undefined, `${response.status}: ${endpoint}`, true);
    let result: { code: number; msg: string; data: T };
    try { result = await response.json(); }
    catch { throw new KernelError(endpoint, undefined, "Invalid kernel response", true); }
    if (result.code !== 0) throw new KernelError(endpoint, result.data, result.msg || `Kernel error ${result.code}`);
    return result.data;
  }
  async readFile(path: string): Promise<ArrayBuffer> {
    const response = await fetch("/api/file/getFile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    if (response.status !== 200) throw new UserError("readFailed", path);
    return response.arrayBuffer();
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

export async function readJSON<T>(kernel: Kernel, path: string): Promise<T> {
  try { return JSON.parse(new TextDecoder().decode(await kernel.readFile(path))); }
  catch (e) { throw new UserError("readFailed", `${path}: ${String(e)}`); }
}
export async function fileExists(kernel: Kernel, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const entries = await kernel.post<DirectoryEntry[]>("/api/file/readDir", { path: path.slice(0, slash) });
  return entries.some(entry => entry.name.toLocaleLowerCase("en-US") === path.slice(slash + 1).toLocaleLowerCase("en-US"));
}

import { UserError } from "../types";

export function normalizeAssetURL(raw: string): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return undefined;
  const part = raw.replace(/^\//, "").split(/[?#]/, 1)[0];
  let path: string;
  try { path = decodeURIComponent(part); } catch { throw new UserError("invalidAssetPath", raw); }
  if (!path.startsWith("assets/")) return undefined;
  assertAssetPath(path);
  return path;
}
export function assertAssetPath(path: string): void {
  if (!path.startsWith("assets/") || /[\\\u0000-\u001f]/.test(path)
      || path.split("/").some(p => !p || p === "." || p === ".." || p.includes(":"))) {
    throw new UserError("invalidAssetPath", path);
  }
}
export const requestPath = (path: string): string => { assertAssetPath(path); return path.split("/").map(encodeURIComponent).join("/"); };
export const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
export function extensionOf(path: string): string {
  const name = basename(path), i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}
export const isImageExtension = (ext: string): boolean => /^\.(?:jpe?g|png|webp)$/i.test(ext);
export const isImageAttachment = (ext: string): boolean => /^\.(?:jpe?g|png|webp|gif|apng|svg|avif|heic|heif|bmp|tiff?|ico)$/i.test(ext);
export const assetURL = (path: string): string => "/" + requestPath(path);

export function rewriteReference(raw: string, next: string, kind: string): string {
  if (kind === "ocr" || kind === "annotation-file") return next;
  const match = raw.match(/^([^?#]*)([?#].*)?$/)!;
  let suffix = match[2] || "";
  if (kind === "annotation") {
    const id = match[1].match(/\/(\d{14}-[a-z0-9]{7})$/)?.[1];
    if (id) suffix = "/" + id + suffix;
  }
  return (raw.startsWith("/") ? "/" : "") + requestPath(next) + suffix;
}

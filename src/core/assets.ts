import { readJSON } from "../api";
import { AssetIdentity, AttachmentStats, DocumentAssets, Kernel, Notebook, UserError } from "../types";
import { assetDiskPath, basename, extensionOf, normalizeAssetURL } from "./paths";
import { databaseSourcePaths, databaseViewPaths } from "./database-order";
import { documentSourceInventory, SourceNode } from "./document-source";
import { checkCancelled } from "./cancellation";
import { ReadPool } from "./read-pool";

const nodeId = /^\d{14}-[a-z0-9]{7}$/;
const menuStats = new WeakMap<Kernel, ReadPool>();

export function orderedPaths(dom: string, titleImage: string, all: string[]): string[] {
  const ordered: string[] = [], seen = new Set<string>();
  const add = (raw: string) => { const p = normalizeAssetURL(raw); if (p && !seen.has(p)) { seen.add(p); ordered.push(p); } };
  for (const match of titleImage.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(match[1].trim());
  const doc = new DOMParser().parseFromString(dom, "text/html");
  // Only the document's own BlockDOM is requested; embeds are not expanded.
  for (const element of doc.querySelectorAll("img[src], a[href], [data-type~='a'][data-href], [data-type='img'] img[data-src]")) {
    add(element.getAttribute("src") || element.getAttribute("data-src") || element.getAttribute("href") || element.getAttribute("data-href") || "");
  }
  all.forEach(add);
  return ordered;
}

export async function documentInventory(kernel: Kernel, id: string, signal?: AbortSignal) {
  checkCancelled(signal);
  if (!nodeId.test(id)) throw new UserError("openDocument");
  const [{ notebooks }, info] = await Promise.all([
    kernel.post<{ notebooks: Notebook[] }>("/api/notebook/lsNotebooks", {}, signal),
    kernel.post<{ box: string; path: string }>("/api/block/getBlockInfo", { id }, signal),
  ]);
  checkCancelled(signal);
  if (!nodeId.test(info?.box) || !info.path?.startsWith("/") || info.path.split("/").includes("..")) throw new UserError("readFailed", id);
  const source = documentSourceInventory(await readJSON<SourceNode>(kernel, `/data/${info.box}${info.path}`, signal), id);
  // Rendering can materialize database metadata; read its source afterward.
  const dbPaths = await databaseViewPaths(kernel, source.databaseDOM, signal);
  const supplemental = await databaseSourcePaths(kernel, source.databaseIds, signal);
  const paths = [...new Set([...source.paths, ...dbPaths, ...supplemental])];
  return { id, title: source.title, notebooks, paths };
}

export async function attachmentStats(kernel: Kernel, paths: string[], signal?: AbortSignal, progress?: (path: string) => void): Promise<{ stats: AttachmentStats; sizes: Map<string, number>; deferred: Set<string> }> {
  checkCancelled(signal);
  const unique = [...new Set(paths)], sizes = new Map<string, number>(), deferred = new Set<string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, unique.length) }, async () => {
    while (cursor < unique.length) {
      checkCancelled(signal);
      const path = unique[cursor++];
      progress?.(path);
      try {
        const stat = await kernel.post<{ size: number; downloaded?: false }>("/api/asset/statAsset", { path }, signal);
        checkCancelled(signal);
        if (Number.isSafeInteger(stat?.size) && stat.size >= 0) sizes.set(path, stat.size);
        if (stat?.downloaded === false) deferred.add(path);
      } catch { checkCancelled(signal); /* Show partial totals explicitly. */ }
    }
  }));
  return { stats: { bytes: [...sizes.values()].reduce((sum, size) => sum + size, 0), unknown: unique.length - sizes.size, count: unique.length }, sizes, deferred };
}
export async function documentStats(kernel: Kernel, id: string, signal?: AbortSignal): Promise<AttachmentStats> {
  let reads = menuStats.get(kernel);
  if (!reads) { reads = new ReadPool(); menuStats.set(kernel, reads); }
  return reads.run(id, async current => (await attachmentStats(kernel, (await documentInventory(kernel, id, current)).paths, current)).stats, signal);
}

export async function scanDocument(kernel: Kernel, id: string, onlyPath?: string, progress?: (path: string) => void, signal?: AbortSignal, wholeDocumentStats = true): Promise<DocumentAssets> {
  const { title, notebooks, paths } = await documentInventory(kernel, id, signal);
  const selectedPath = onlyPath ? normalizeAssetURL(onlyPath) : undefined;
  if (onlyPath && !selectedPath) throw new UserError("invalidAssetPath", onlyPath);
  const chosen = selectedPath ? paths.filter(p => p === selectedPath) : paths;
  if (onlyPath && !chosen.length) throw new UserError("sourceChanged");
  const { stats, sizes, deferred } = await attachmentStats(kernel, wholeDocumentStats ? paths : chosen, signal, progress);
  if (!chosen.length) return { id, title, notebooks, assets: [], stats };
  // Browsing only needs the kernel's resolved path for this document's files.
  // Cross-workspace ambiguity, symlinks and completeness are checked by the
  // fresh native reference preflight before any job writes an attachment.
  const locations = new Map<string, string>();
  const local = chosen.filter(path => sizes.has(path) && !deferred.has(path));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, local.length) }, async () => {
    while (cursor < local.length) {
      checkCancelled(signal);
      const path = local[cursor++]; progress?.(path);
      try {
        const diskPath = await kernel.post<string>("/api/asset/resolveAssetPath", { path }, signal);
        checkCancelled(signal);
        const localPath = typeof diskPath === "string" ? assetDiskPath(diskPath, path) : undefined;
        if (localPath) locations.set(path, localPath);
      } catch { checkCancelled(signal); /* An unresolved file remains blocked. */ }
    }
  }));
  const assets: AssetIdentity[] = [];
  for (const path of chosen) {
    checkCancelled(signal);
    progress?.(path);
    const asset: AssetIdentity = { path, diskPath: locations.get(path) || "", name: basename(path), extension: extensionOf(path),
      size: sizes.get(path) ?? 0, sizeKnown: sizes.has(path), references: [], referencesLoaded: false, blockers: [], selected: true, order: assets.length };
    if (deferred.has(path)) asset.blockers.push("missingLocalAsset");
    else if (!asset.diskPath) asset.blockers.push("readFailed");
    asset.selected = !asset.blockers.length; assets.push(asset);
  }
  return { id, title, notebooks, assets, stats };
}

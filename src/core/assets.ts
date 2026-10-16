import { readJSON } from "../api";
import { AssetIdentity, AttachmentStats, DirectoryEntry, DocumentAssets, Kernel, Notebook, UserError } from "../types";
import { basename, extensionOf, normalizeAssetURL } from "./paths";
import { findReferences } from "./references";
import { databaseViewPaths } from "./database-order";
import { documentSourceInventory, SourceNode } from "./document-source";

const nodeId = /^\d{14}-[a-z0-9]{7}$/;
export async function inventoryAssets(kernel: Kernel, targets: Set<string>): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const read = async (path: string) => kernel.post<DirectoryEntry[]>("/api/file/readDir", { path });
  const assets = async (disk: string, relative: string): Promise<void> => {
    for (const entry of await read(disk)) {
      const path = relative + "/" + entry.name;
      if (entry.isSymlink) throw new UserError("unsafeSymlink", disk + "/" + entry.name);
      if (entry.isDir) await assets(disk + "/" + entry.name, path);
      else if (targets.has(path)) result.set(path, [...(result.get(path) || []), disk + "/" + entry.name]);
    }
  };
  const notebook = async (dir: string): Promise<void> => {
    for (const entry of await read(dir)) {
      if (entry.isSymlink) throw new UserError("unsafeSymlink", dir + "/" + entry.name);
      if (!entry.isDir) continue;
      if (entry.name === "assets") await assets(dir + "/assets", "assets");
      else if (nodeId.test(entry.name)) await notebook(dir + "/" + entry.name);
    }
  };
  for (const entry of await read("/data")) {
    if (!entry.isDir) continue;
    if (entry.isSymlink && (entry.name === "assets" || nodeId.test(entry.name))) throw new UserError("unsafeSymlink", entry.name);
    if (entry.name === "assets") await assets("/data/assets", "assets");
    else if (nodeId.test(entry.name)) {
      const conf = await readJSON<{ encrypted?: boolean }>(kernel, `/data/${entry.name}/.siyuan/conf.json`);
      if (conf.encrypted) throw new UserError("incompleteScan", entry.name);
      await notebook("/data/" + entry.name);
    }
  }
  return result;
}

export function orderedPaths(dom: string, titleImage: string, all: string[]): string[] {
  const ordered: string[] = [];
  const add = (raw: string) => { const p = normalizeAssetURL(raw); if (p && !ordered.includes(p)) ordered.push(p); };
  for (const match of titleImage.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(match[1].trim());
  const doc = new DOMParser().parseFromString(dom, "text/html");
  // Only the document's own BlockDOM is requested; embeds are not expanded.
  for (const element of doc.querySelectorAll("img[src], a[href], [data-type~='a'][data-href], [data-type='img'] img[data-src]")) {
    add(element.getAttribute("src") || element.getAttribute("data-src") || element.getAttribute("href") || element.getAttribute("data-href") || "");
  }
  all.forEach(add);
  return ordered;
}

export async function documentInventory(kernel: Kernel, id: string) {
  if (!nodeId.test(id)) throw new UserError("openDocument");
  const [{ notebooks }, info, all] = await Promise.all([
    kernel.post<{ notebooks: Notebook[] }>("/api/notebook/lsNotebooks", {}),
    kernel.post<{ box: string; path: string }>("/api/block/getBlockInfo", { id }),
    kernel.post<string[] | null>("/api/asset/getDocAssets", { id, retainQueryStr: true }),
  ]);
  if (!nodeId.test(info?.box) || !info.path?.startsWith("/") || info.path.split("/").includes("..") || (all !== null && !Array.isArray(all))) throw new UserError("readFailed", id);
  const source = documentSourceInventory(await readJSON<SourceNode>(kernel, `/data/${info.box}${info.path}`), id);
  const dbPaths = await databaseViewPaths(kernel, source.databaseDOM);
  const paths = [...source.paths];
  for (const raw of dbPaths) { const path = normalizeAssetURL(raw); if (path && !paths.includes(path)) paths.push(path); }
  // Supplemental kernel entries can be stale after relinking. Verify ownership.
  const seen = new Set(paths);
  for (const raw of all || []) {
    const path = normalizeAssetURL(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const report = await findReferences(kernel, path);
    if (report.references.some(ref => ref.rootID === id || source.databaseIds.has(ref.avID))) paths.push(path);
  }
  return { id, title: source.title, notebooks, paths };
}

export async function attachmentStats(kernel: Kernel, paths: string[]): Promise<{ stats: AttachmentStats; sizes: Map<string, number> }> {
  const unique = [...new Set(paths)], sizes = new Map<string, number>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, unique.length) }, async () => {
    while (cursor < unique.length) {
      const path = unique[cursor++];
      try {
        const stat = await kernel.post<{ size: number }>("/api/asset/statAsset", { path });
        if (Number.isSafeInteger(stat?.size) && stat.size >= 0) sizes.set(path, stat.size);
      } catch { /* Show partial totals explicitly. */ }
    }
  }));
  return { stats: { bytes: [...sizes.values()].reduce((sum, size) => sum + size, 0), unknown: unique.length - sizes.size, count: unique.length }, sizes };
}
export async function documentStats(kernel: Kernel, id: string): Promise<AttachmentStats> {
  return (await attachmentStats(kernel, (await documentInventory(kernel, id)).paths)).stats;
}

export async function scanDocument(kernel: Kernel, id: string, onlyPath?: string, progress?: (path: string) => void): Promise<DocumentAssets> {
  const { title, notebooks, paths } = await documentInventory(kernel, id);
  const selectedPath = onlyPath ? normalizeAssetURL(onlyPath) : undefined;
  if (onlyPath && !selectedPath) throw new UserError("invalidAssetPath", onlyPath);
  const chosen = selectedPath ? paths.filter(p => p === selectedPath) : paths;
  if (onlyPath && !chosen.length) throw new UserError("sourceChanged");
  const { stats, sizes } = await attachmentStats(kernel, paths);
  if (!chosen.length) return { id, title, notebooks, assets: [], stats };
  const inventory = await inventoryAssets(kernel, new Set(chosen));
  const assets: AssetIdentity[] = [];
  for (const path of chosen) {
    progress?.(path);
    const candidates = inventory.get(path) || [];
    const asset: AssetIdentity = { path, diskPath: candidates[0] || "", name: basename(path), extension: extensionOf(path),
      size: sizes.get(path) ?? 0, sizeKnown: sizes.has(path), references: [], blockers: [], selected: true, order: assets.length };
    if (candidates.length !== 1) asset.blockers.push(candidates.length ? "ambiguousAsset" : "missingLocalAsset");
    try {
      const report = await findReferences(kernel, path); asset.references = report.references;
      if (!asset.references.length) asset.blockers.push("noReferences");
      if (!asset.sizeKnown) throw new UserError("readFailed", path);
    } catch (error) {
      // A failure to inspect the workspace invalidates the whole preview, not just one image.
      if (error instanceof UserError && ["incompleteScan", "unavailableDatabase", "unsupportedKernel"].includes(error.code)) throw error;
      asset.blockers.push(error instanceof UserError ? error.code : String(error));
    }
    asset.selected = !asset.blockers.length; assets.push(asset);
  }
  return { id, title, notebooks, assets, stats };
}

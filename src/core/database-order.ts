import { Kernel, UserError } from "../types";
import { normalizeAssetURL } from "./paths";
import { checkCancelled } from "./cancellation";
import { readJSON } from "../api";

interface RenderView {
  rows?: { id: string; cells: Cell[] }[];
  cards?: { id: string; values: Cell[] }[];
  groups?: RenderView[];
  rowCount?: number; cardCount?: number;
}
interface Cell { value?: { mAsset?: { content: string }[]; url?: { content: string } } }

/** Read the kernel's sorted/paginated view, without applying our own approximation of its sorting. */
export async function databaseViewPaths(kernel: Kernel, dom: string, signal?: AbortSignal): Promise<string[]> {
  checkCancelled(signal);
  const doc = new DOMParser().parseFromString(dom, "text/html"), result: string[] = [], seenViews = new Set<string>();
  const add = (raw: string) => { const path = normalizeAssetURL(raw); if (path && !result.includes(path)) result.push(path); };
  for (const element of doc.querySelectorAll('[data-type="NodeAttributeView"][data-av-id]')) {
    checkCancelled(signal);
    const id = element.getAttribute("data-av-id")!, viewID = element.getAttribute("data-av-view-id") || undefined;
    const key = `${id}:${viewID || ""}`;
    if (seenViews.has(key)) continue; seenViews.add(key);
    if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new UserError("unavailableDatabase", id);
    const seenRows = new Set<string>();
    for (let page = 1; page <= 10000; page++) {
      checkCancelled(signal);
      const data = await kernel.post<{ view: RenderView }>("/api/av/renderAttributeView", { id, ...(viewID ? { viewID } : {}), page, pageSize: 200 }, signal);
      checkCancelled(signal);
      if (!data?.view) throw new UserError("unavailableDatabase", id);
      let added = 0;
      const visit = (view: RenderView) => {
        for (const row of view.rows || view.cards || []) {
          if (seenRows.has(row.id)) continue; seenRows.add(row.id); added++;
          for (const cell of "cells" in row ? row.cells : row.values) {
            for (const asset of cell.value?.mAsset || []) add(asset.content);
            if (cell.value?.url) add(cell.value.url.content);
          }
        }
        view.groups?.forEach(visit);
      };
      visit(data.view);
      if (!added) break;
      const count = data.view.rowCount ?? data.view.cardCount;
      if (count !== undefined && !data.view.groups?.length && seenRows.size >= count) break;
      if (page === 10000) throw new UserError("unavailableDatabase", id);
    }
  }
  return result;
}

/** Include hidden/filtered values from this document's databases without a workspace lookup. */
export async function databaseSourcePaths(kernel: Kernel, ids: Set<string>, signal?: AbortSignal): Promise<string[]> {
  const paths = new Set<string>();
  const add = (raw: unknown) => { if (typeof raw === "string") { const path = normalizeAssetURL(raw); if (path) paths.add(path); } };
  const visit = async (value: unknown): Promise<void> => {
    checkCancelled(signal);
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) await visit(item); return; }
    const entry = value as { mAsset?: { content?: string }[]; url?: { content?: string }; text?: { rich?: { content?: string } } };
    if (Array.isArray(entry.mAsset)) for (const asset of entry.mAsset) add(asset?.content);
    add(entry.url?.content);
    if (entry.text?.rich) {
      const data = await kernel.post<{ html: string }>("/api/lute/md2html", { markdown: entry.text.rich.content }, signal);
      checkCancelled(signal);
      if (typeof data?.html !== "string") throw new UserError("unavailableDatabase");
      const doc = new DOMParser().parseFromString(data.html, "text/html");
      for (const link of doc.querySelectorAll("[src], [href], [data-href]")) for (const key of ["src", "href", "data-href"]) add(link.getAttribute(key));
    }
    for (const item of Object.values(value)) await visit(item);
  };
  for (const id of ids) {
    checkCancelled(signal);
    if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new UserError("unavailableDatabase", id);
    try {
      const source = await readJSON<{ id: string; keyValues?: unknown[] }>(kernel, `/data/storage/av/${id}.json`, signal);
      if (source?.id !== id || (source.keyValues != null && !Array.isArray(source.keyValues))) throw new UserError("unavailableDatabase", id);
      await visit(source);
    } catch { checkCancelled(signal); throw new UserError("unavailableDatabase", id); }
  }
  return [...paths];
}

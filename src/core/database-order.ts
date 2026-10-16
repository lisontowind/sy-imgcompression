import { Kernel, UserError } from "../types";
import { normalizeAssetURL } from "./paths";

interface RenderView {
  rows?: { id: string; cells: Cell[] }[];
  cards?: { id: string; values: Cell[] }[];
  groups?: RenderView[];
  rowCount?: number; cardCount?: number;
}
interface Cell { value?: { mAsset?: { content: string }[]; url?: { content: string } } }

/** Read the kernel's sorted/paginated view, without applying our own approximation of its sorting. */
export async function databaseViewPaths(kernel: Kernel, dom: string): Promise<string[]> {
  const doc = new DOMParser().parseFromString(dom, "text/html"), result: string[] = [], seenViews = new Set<string>();
  const add = (raw: string) => { const path = normalizeAssetURL(raw); if (path && !result.includes(path)) result.push(path); };
  for (const element of doc.querySelectorAll('[data-type="NodeAttributeView"][data-av-id]')) {
    const id = element.getAttribute("data-av-id")!, viewID = element.getAttribute("data-av-view-id") || undefined;
    const key = `${id}:${viewID || ""}`;
    if (seenViews.has(key)) continue; seenViews.add(key);
    if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new UserError("unavailableDatabase", id);
    const seenRows = new Set<string>();
    for (let page = 1; page <= 10000; page++) {
      const data = await kernel.post<{ view: RenderView }>("/api/av/renderAttributeView", { id, ...(viewID ? { viewID } : {}), page, pageSize: 200 });
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

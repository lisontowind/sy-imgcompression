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
  const doc = new DOMParser().parseFromString(dom, "text/html"), result: string[] = [], seenPaths = new Set<string>(), seenViews = new Set<string>();
  const add = (raw: string) => { const path = normalizeAssetURL(raw); if (path && !seenPaths.has(path)) { seenPaths.add(path); result.push(path); } };
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
  const tokens: (string | { markdown: string })[] = [], rendered = new Map<string, string[]>();
  const add = (raw: unknown) => { if (typeof raw === "string") { const path = normalizeAssetURL(raw); if (path) tokens.push(path); } };
  for (const id of ids) {
    checkCancelled(signal);
    if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new UserError("unavailableDatabase", id);
    try {
      const source = await readJSON<{ id: string; keyValues?: unknown[] }>(kernel, `/data/storage/av/${id}.json`, signal);
      if (source?.id !== id || (source.keyValues != null && !Array.isArray(source.keyValues))) throw new UserError("unavailableDatabase", id);
      const stack: unknown[] = [source]; let visited = 0;
      while (stack.length) {
        if (++visited % 2048 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        checkCancelled(signal);
        const value = stack.pop();
        if (!value || typeof value !== "object") continue;
        if (!Array.isArray(value)) {
          const entry = value as { mAsset?: { content?: string }[]; url?: { content?: string }; text?: { rich?: { content?: string } } };
          if (Array.isArray(entry.mAsset)) for (const asset of entry.mAsset) add(asset?.content);
          add(entry.url?.content);
          if (entry.text?.rich) {
            const markdown = entry.text.rich.content;
            if (typeof markdown !== "string") throw new UserError("unavailableDatabase");
            // A local asset URL needs a slash or an escaped slash. Plain text
            // cannot produce an attachment link, even when rendered as Markdown.
            if (/[\/%&\\]/.test(markdown) && !rendered.has(markdown)) { tokens.push({ markdown }); rendered.set(markdown, []); }
          }
        }
        const children = Object.values(value);
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
    } catch { checkCancelled(signal); throw new UserError("unavailableDatabase", id); }
  }
  const markdowns = [...rendered.keys()]; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, markdowns.length) }, async () => {
    while (cursor < markdowns.length) {
      checkCancelled(signal); const markdown = markdowns[cursor++];
      const data = await kernel.post<{ html: string }>("/api/lute/md2html", { markdown }, signal);
      checkCancelled(signal);
      if (typeof data?.html !== "string") throw new UserError("unavailableDatabase");
      const paths = new Set<string>(), doc = new DOMParser().parseFromString(data.html, "text/html");
      for (const link of doc.querySelectorAll("[src], [href], [data-href]")) for (const key of ["src", "href", "data-href"]) {
        const raw = link.getAttribute(key), path = raw ? normalizeAssetURL(raw) : undefined; if (path) paths.add(path);
      }
      rendered.set(markdown, [...paths]);
    }
  }));
  const paths = new Set<string>();
  for (const token of tokens) for (const path of typeof token === "string" ? [token] : rendered.get(token.markdown)!) paths.add(path);
  return [...paths];
}

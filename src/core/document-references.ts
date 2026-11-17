import { fileExists, readJSON } from "../api";
import { AssetJob, DocumentChange, JobItem, Kernel, UserError } from "../types";
import { SourceNode, documentSourceInventory } from "./document-source";
import { normalizeAssetURL, rewriteReference } from "./paths";
import { digest } from "./references";
import { BatchContext } from "./batch-operations";
import { checkCancelled } from "./cancellation";

const ignoredDOMAttributes = ["updated", "data-updated", "data-node-index"];
function parseDOM(dom: string): Document { return new DOMParser().parseFromString(dom, "text/html"); }
function canonicalDOM(dom: string): string {
  const doc = parseDOM(dom);
  for (const node of doc.querySelectorAll("*")) for (const key of ignoredDOMAttributes) node.removeAttribute(key);
  return doc.body.innerHTML;
}
function replaceURL(raw: string, oldPath: string, newPath: string): string {
  try { return normalizeAssetURL(raw) === oldPath ? rewriteReference(raw, newPath, "link") : raw; }
  catch { return raw; }
}
function replaceCSS(raw: string, oldPath: string, newPath: string): string {
  return raw.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (all, quote: string, url: string) => {
    const next = replaceURL(url.trim(), oldPath, newPath);
    return next === url.trim() ? all : `url(${quote}${next}${quote})`;
  });
}
function rewriteElement(node: Element, oldPath: string, newPath: string, html = true): boolean {
  let changed = false;
  for (const attr of [...node.attributes]) {
    let next = attr.value;
    if (["src", "data-src", "href", "data-href"].includes(attr.name)) next = replaceURL(next, oldPath, newPath);
    else if (attr.name === "style") next = replaceCSS(next, oldPath, newPath);
    else if (attr.name === "data-assets" || attr.name.startsWith("custom-data-assets")) {
      next = replaceURL(next, oldPath, newPath);
      if (next === attr.value) next = next.replace(/[^\s,]+/g, value => replaceURL(value, oldPath, newPath));
    } else if (html && attr.name === "data-content" && (node.getAttribute("data-type") === "NodeHTMLBlock" || node.matches("protyle-html"))) {
      const content = parseDOM(next); let edited = false;
      for (const element of content.querySelectorAll("*")) edited = rewriteElement(element, oldPath, newPath, false) || edited;
      if (edited) next = content.body.innerHTML;
    }
    if (next !== attr.value) { node.setAttribute(attr.name, next); changed = true; }
  }
  return changed;
}

async function readDocument(kernel: Kernel, id: string, signal?: AbortSignal): Promise<SourceNode> {
  if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new UserError("openDocument");
  const info = await kernel.post<{ box: string; path: string }>("/api/block/getBlockInfo", { id }, signal);
  if (!/^\d{14}-[a-z0-9]{7}$/.test(info?.box) || !info.path?.endsWith(`/${id}.sy`) || info.path.split("/").includes("..")) throw new UserError("readFailed");
  const source = await readJSON<SourceNode>(kernel, `/data/${info.box}${info.path}`, signal);
  documentSourceInventory(source, id);
  return source;
}
async function ownedDocument(kernel: Kernel, id: string, signal?: AbortSignal): Promise<Set<string>> {
  const source = await readDocument(kernel, id, signal);
  const owned = new Set<string>();
  const visit = (node: SourceNode) => {
    if (["NodeAttributeView", "NodeBlockQueryEmbed", "NodeBlockRef"].includes(node.Type)) return;
    if (node.ID) owned.add(node.ID);
    node.Children?.forEach(visit);
  };
  visit(source); return owned;
}
async function readChange(kernel: Kernel, change: DocumentChange, signal?: AbortSignal): Promise<string> {
  if (change.kind === "title-img") {
    // getBlockAttrs may retain an old IAL cache after a native workspace relink.
    // Read the current document's persisted property, not that cached value.
    const source = await readDocument(kernel, change.blockID, signal);
    const text = document.createElement("textarea"); text.innerHTML = source.Properties?.["title-img"] || "";
    return text.value;
  }
  const data = await kernel.post<{ dom: string }>("/api/block/getBlockDOM", { id: change.blockID }, signal);
  if (typeof data?.dom !== "string") throw new UserError("readFailed");
  return canonicalDOM(data.dom);
}
async function writeChange(kernel: Kernel, change: DocumentChange, value: string): Promise<void> {
  if (change.kind === "title-img") await kernel.post("/api/attr/setBlockAttrs", { id: change.blockID, attrs: { "title-img": value } });
  else await kernel.post("/api/block/updateBlock", { id: change.blockID, dataType: "dom", data: value });
}

async function planChanges(kernel: Kernel, job: AssetJob, item: JobItem, signal?: AbortSignal): Promise<DocumentChange[]> {
  const owned = await ownedDocument(kernel, job.documentId, signal);
  const data = await kernel.post<{ dom: string }>("/api/block/getBlockDOM", { id: job.documentId }, signal);
  if (typeof data?.dom !== "string") throw new UserError("readFailed");
  const doc = parseDOM(data.dom), changed = new Map<Element, string>();
  // Inspect detached BlockDOM only. Rendered embeds and database rows are never owners.
  for (const node of doc.querySelectorAll("*")) {
    const block = node.closest("[data-node-id]");
    const id = block?.getAttribute("data-node-id");
    if (!block || !id || id === job.documentId || !owned.has(id)) continue;
    const before = block.outerHTML;
    if (rewriteElement(node, item.oldPath, item.newPath) && !changed.has(block)) changed.set(block, before);
  }
  // A parent snapshot already contains its descendants; do not update a child twice.
  const blocks = [...changed.keys()].filter(block => ![...changed.keys()].some(parent => parent !== block && parent.contains(block)));
  const changes: DocumentChange[] = blocks.map(block => ({ blockID: block.getAttribute("data-node-id")!, kind: "dom",
    before: canonicalDOM(changed.get(block)!), after: canonicalDOM(block.outerHTML) }));
  const title: DocumentChange = { blockID: job.documentId, kind: "title-img", before: "", after: "" };
  title.before = await readChange(kernel, title, signal); title.after = replaceCSS(title.before, item.oldPath, item.newPath);
  if (title.after !== title.before) changes.push(title);
  return changes;
}

export async function applyDocumentCopy(kernel: Kernel, job: AssetJob, item: JobItem, bytes: ArrayBuffer, context: Pick<BatchContext, "save" | "checkCancelled" | "restore" | "signal" | "progress">): Promise<void> {
  item.documentId = job.documentId;
  try {
    item.documentChanges = await planChanges(kernel, job, item, context.signal);
    if (!item.documentChanges.length) { item.state = "skipped"; item.error = "noDocumentReferences"; await context.save(); return; }
    context.checkCancelled();
    if (await fileExists(kernel, item.newDiskPath)) throw new UserError("filenameConflict");
    if (await digest(await kernel.readFile(item.oldDiskPath, context.signal)) !== item.sourceDigest) throw new UserError("sourceChanged");
    item.state = "prepared"; await context.save();
    context.checkCancelled(); await kernel.putFile(item.newDiskPath, bytes);
    if (await digest(await kernel.readFile(item.newDiskPath, context.signal)) !== item.targetDigest
        || await digest(await kernel.readFile(item.oldDiskPath, context.signal)) !== item.sourceDigest) throw new UserError("writeVerificationFailed");
    for (const change of item.documentChanges) if (await readChange(kernel, change, context.signal) !== change.before) throw new UserError("sourceChanged");
    context.checkCancelled(); item.state = "applying"; await context.save();
    context.progress({ done: job.items.filter(value => value.state === "completed").length, total: job.items.length, path: item.oldPath, stage: "updatingDocumentReferences" });
    for (const change of item.documentChanges) {
      context.checkCancelled();
      if (await readChange(kernel, change, context.signal) !== change.before) throw new UserError("sourceChanged");
      await writeChange(kernel, change, change.after);
      const actual = await readChange(kernel, change);
      if (actual !== change.after) throw new UserError("writeVerificationFailed");
      change.verified = actual; await context.save();
    }
    context.checkCancelled(); item.state = "completed"; await context.save();
  } catch (error) {
    item.error = error instanceof UserError ? error.code : String(error);
    const applying = item.state === "applying";
    item.state = applying ? "recovery-required" : "failed"; await context.save();
    if (applying) {
      try { await context.restore([item]); }
      catch (recoveryError) { item.state = "recovery-required"; item.error += "; " + String(recoveryError); }
      await context.save();
    }
    throw error;
  }
}

export async function restoreDocumentCopy(kernel: Kernel, item: JobItem, save: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!item.documentId || !item.documentChanges?.length || !item.sourceDigest || !item.targetDigest
      || await digest(await kernel.readFile(item.oldDiskPath, signal)) !== item.sourceDigest
      || await digest(await kernel.readFile(item.newDiskPath, signal)) !== item.targetDigest) throw new UserError("restoreConflict");
  const owned = await ownedDocument(kernel, item.documentId, signal);
  for (const change of [...item.documentChanges].reverse()) {
    checkCancelled(signal);
    if (!owned.has(change.blockID)) throw new UserError("restoreConflict");
    const current = await readChange(kernel, change, signal);
    if (current === change.before) continue;
    if (current !== (change.verified || change.after)) throw new UserError("restoreConflict");
    item.state = "recovery-required"; await save(); checkCancelled(signal);
    await writeChange(kernel, change, change.before);
    if (await readChange(kernel, change) !== change.before) throw new UserError("restoreConflict");
  }
  item.state = "restored"; await save();
}

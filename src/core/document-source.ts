import { normalizeAssetURL } from "./paths";
import { UserError } from "../types";

export interface SourceNode {
  ID?: string; Type: string; Spec?: string; Data?: string; Properties?: Record<string, string>;
  Children?: SourceNode[]; TextMarkType?: string; TextMarkAHref?: string; TextMarkFileAnnotationRefID?: string;
  AttributeViewID?: string;
}
export interface SourceInventory { title: string; paths: string[]; databaseDOM: string; databaseIds: Set<string> }
function unescapeHTML(value: string): string { const node = document.createElement("textarea"); node.innerHTML = value; return node.value; }

/** Read only the document's own source tree; never expand block references or embeds. */
export function documentSourceInventory(root: SourceNode, id: string): SourceInventory {
  if (!root || root.Type !== "NodeDocument" || root.ID !== id || (root.Children != null && !Array.isArray(root.Children))) throw new UserError("readFailed", id);
  const paths: string[] = [], views: string[] = [], databaseIds = new Set<string>();
  const add = (raw: string) => { const path = normalizeAssetURL(unescapeHTML(raw)); if (path && !paths.includes(path)) paths.push(path); };
  const css = (value: string) => { for (const match of unescapeHTML(value).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(match[1].trim()); };
  css(root.Properties?.["title-img"] || "");
  const visit = (node: SourceNode) => {
    if (!node || typeof node.Type !== "string") throw new UserError("readFailed", id);
    if (node.Type === "NodeLinkDest" && node.Data) add(node.Data);
    if (node.Type === "NodeTextMark" && node.TextMarkType?.split(" ").includes("a") && node.TextMarkAHref) add(node.TextMarkAHref);
    if (node.Type === "NodeAttributeView") {
      const avID = node.AttributeViewID || node.Properties?.["av-id"] || node.Data;
      if (!avID || !/^\d{14}-[a-z0-9]{7}$/.test(avID)) throw new UserError("unavailableDatabase", avID || node.ID || id);
      databaseIds.add(avID);
      views.push(`<div data-type="NodeAttributeView" data-av-id="${avID}"></div>`);
    }
    if (["NodeHTMLBlock", "NodeInlineHTML", "NodeIFrame", "NodeAudio", "NodeVideo", "NodeWidget"].includes(node.Type) && node.Data) {
      const html = new DOMParser().parseFromString(node.Data, "text/html");
      for (const element of html.querySelectorAll("[src], [href], [data-src], [poster], [data], [style]")) {
        for (const key of ["src", "href", "data-src", "poster", "data"]) { const value = element.getAttribute(key); if (value) add(value); }
        css(element.getAttribute("style") || "");
      }
    }
    for (const [key, value] of Object.entries(node.Properties || {})) {
      if (key === "data-assets" || key.startsWith("custom-data-assets")) {
        if (normalizeAssetURL(unescapeHTML(value))) add(value);
        else value.split(/[\s,]+/).forEach(add);
      }
    }
    node.Children?.forEach(visit);
  };
  root.Children?.forEach(visit);
  return { title: root.Properties?.title || "", paths, databaseDOM: views.join(""), databaseIds };
}

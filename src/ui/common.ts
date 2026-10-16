import { AttachmentStats } from "../types";
import { Translator } from "../i18n";

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
export function statsText(stats: AttachmentStats, t: Translator): string {
  return t("totalSize", { size: formatSize(stats.bytes) }) + (stats.unknown ? ` · ${t("unknownSizes", { count: stats.unknown })}` : "");
}
export function button(label: string, action: () => void | Promise<void>, error: (error: unknown) => void): HTMLButtonElement {
  const node = element("button", "b3-button b3-button--outline", label); node.type = "button";
  node.addEventListener("click", () => { void Promise.resolve().then(action).catch(error); }); return node;
}

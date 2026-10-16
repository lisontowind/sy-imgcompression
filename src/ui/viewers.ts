import { App, Dialog, Protyle } from "siyuan";
import { AssetIdentity, DocumentAssets, Kernel } from "../types";
import { Translator } from "../i18n";
import { assetURL } from "../core/paths";
import { element, button, formatSize } from "./common";

export class ChildPanel {
  readonly root = element("div", "syic syic-child");
  readonly dialog: Dialog;
  closed = false;
  private cleanup: (() => void)[] = [];
  constructor(title: string, done: () => void = () => {}, size: { width: string; height: string } = { width: "960px", height: "76vh" }) {
    this.dialog = new Dialog({ title, content: '<div class="syic-child-mount"></div>', ...size, destroyCallback: () => {
      this.closed = true; for (const dispose of this.cleanup.splice(0)) dispose(); done();
    } });
    this.dialog.element.querySelector(".syic-child-mount")!.append(this.root);
  }
  own(cleanup: () => void): void { if (this.closed) cleanup(); else this.cleanup.push(cleanup); }
  url(bytes: ArrayBuffer): string { const url = URL.createObjectURL(new Blob([bytes])); this.own(() => URL.revokeObjectURL(url)); return url; }
  destroy(): void { if (!this.closed) this.dialog.destroy(); }
}

export function originalImage(root: HTMLElement, asset: AssetIdentity, t: Translator): HTMLImageElement {
  const image = element("img", "syic-original"); image.alt = asset.name; image.src = assetURL(asset.path);
  const info = element("p", "syic-image-info", `${asset.name} · ${asset.sizeKnown === false ? t("unknownSize") : formatSize(asset.size)}`);
  image.addEventListener("load", () => { info.textContent += ` · ${image.naturalWidth} × ${image.naturalHeight}`; }, { once: true });
  image.addEventListener("error", () => { info.textContent = t("imageUnavailable"); });
  root.append(info, image); return image;
}

export function referenceViewer(panel: ChildPanel, asset: AssetIdentity, doc: DocumentAssets, app: App | undefined, t: Translator, kernel: Kernel): void {
  const layout = element("div", "syic-reference-layout"), list = element("div", "syic-reference-list"), content = element("div", "syic-reference-content");
  layout.append(list, content); panel.root.append(layout);
  let reader: Protyle | undefined, generation = 0;
  panel.own(() => { generation++; reader?.destroy(); });
  const error = () => { content.replaceChildren(element("p", "syic-note", t("referenceUnavailable"))); };
  const titles = new Map<string, Promise<string>>();
  for (const ref of asset.references) {
    const book = doc.notebooks.find(book => book.id === ref.notebook);
    const row = element("div", "syic-ref");
    const label = (title: string) => `${book?.name || ref.notebook || t("unknownNotebook")}${book?.closed ? ` (${t("closed")})` : ""} · ${title} · ${ref.type} · ${ref.blockID || ref.valueID || ref.path || ""}`;
    const target = button(label(ref.rootID === doc.id ? doc.title : ref.rootID || ref.path || ref.avID), async () => {
      const token = ++generation; reader?.destroy(); reader = undefined; content.replaceChildren();
      if (!app || book?.closed || !ref.rootID) { error(); return; }
      try {
        await kernel.post("/api/block/getBlockInfo", { id: ref.blockID || ref.rootID });
        if (panel.closed || token !== generation) return;
        const mount = element("div", "syic-reader"); content.append(mount);
        reader = new Protyle(app, mount, { blockId: ref.blockID || ref.rootID, rootId: ref.rootID, mode: "wysiwyg", action: ["cb-get-hl", "cb-get-context", "cb-get-av-no-create"],
          render: { title: true, breadcrumb: true, gutter: false, background: false },
          after: instance => { if (panel.closed || token !== generation) { instance.destroy(); return; } instance.disable(); },
        });
        reader.disable();
      } catch { if (token === generation && !panel.closed) error(); }
    }, error);
    row.append(target); list.append(row);
    if (ref.rootID && ref.rootID !== doc.id) {
      if (!titles.has(ref.rootID)) titles.set(ref.rootID, kernel.post<{ name: string }>("/api/block/getDocInfo", { id: ref.rootID }).then(info => info?.name || ref.rootID).catch(() => ref.rootID));
      void titles.get(ref.rootID)!.then(title => { if (!panel.closed) target.textContent = label(title); });
    }
  }
  if (!asset.references.length) content.append(element("p", "syic-note", t("noReferences")));
  else content.append(element("p", "syic-note", t("selectReference")));
}

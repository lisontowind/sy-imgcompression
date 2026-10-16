import { Dialog, getActiveEditor, getFrontend, Plugin, showMessage } from "siyuan";
import type { IEventBusMap, IProtyle, subMenu } from "siyuan";
import { SiYuanKernel } from "./api";
import { JobManager } from "./core/jobs";
import { documentStats, scanDocument } from "./core/assets";
import { cloneProfile, loadSettings } from "./core/settings";
import { assetURL, extensionOf, isImageExtension, normalizeAssetURL } from "./core/paths";
import { translator, Translator } from "./i18n";
import { AttachmentPanel } from "./ui/panel";
import { ChildPanel } from "./ui/viewers";
import { quickSettingsDialog } from "./ui/quick-settings";
import { CompressionProfile, JobKind, Journal, UserError } from "./types";
import { formatSize, statsText } from "./ui/common";
import "./index.css";

export default class ImageCompressionPlugin extends Plugin {
  private api = new SiYuanKernel();
  private manager?: JobManager;
  private dialog?: Dialog;
  private panel?: AttachmentPanel;
  private quickDialog?: ChildPanel;
  private t: Translator = key => key;
  private loadError?: unknown;
  private settings = loadSettings(undefined);
  private settingsQueue: Promise<void> = Promise.resolve();
  private unloaded = false;
  private quickBusy = false;
  private readonly imageMenu = (event: CustomEvent<IEventBusMap["open-menu-image"]>) => {
    const { menu, element, protyle } = event.detail;
    const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
    const path = image?.getAttribute("data-src") || image?.getAttribute("src");
    if (!path) return;
    let local: string | undefined;
    try { local = normalizeAssetURL(path); } catch { return; }
    if (!local) return;
    const target = local;
    this.infoItem(menu, async () => {
      const [size, dimensions] = await Promise.all([
        this.api.post<{ size: number }>("/api/asset/statAsset", { path: target }).then(stat => Number.isSafeInteger(stat?.size) && stat.size >= 0 ? formatSize(stat.size) : this.t("unknownSize")).catch(() => this.t("unknownSize")),
        this.dimensions(target, image),
      ]);
      return `${dimensions} · ${size}`;
    });
    if (this.readonly(protyle)) return;
    menu.addItem({ icon: "iconSyicCompress", label: this.t("compressImage"), click: () => { void this.open("compress", protyle, target); } });
    menu.addItem({ icon: "iconSyicCompress", label: this.t("quickCompress"), disabled: !isImageExtension(extensionOf(target)) || this.quickBusy || !!this.manager?.busy,
      click: () => { void this.quickCompress(protyle, target); } });
    menu.addItem({ icon: "iconSettings", label: this.t("quickSettings"), click: () => { this.openQuickSettings(); } });
  };
  private readonly documentMenu = (event: CustomEvent<IEventBusMap["click-editortitleicon"]>) => {
    const { menu, protyle } = event.detail;
    this.addDocumentMenu(menu, protyle.block.rootID || "", protyle);
  };
  private readonly treeMenu = (event: CustomEvent<IEventBusMap["open-menu-doctree"]>) => {
    const { menu, type, items } = event.detail;
    if (type === "doc" && items.length === 1) this.addDocumentMenu(menu, items[0].id);
  };
  private addDocumentMenu(menu: subMenu, id: string, protyle?: IProtyle): void {
    if (!id) return;
    this.infoItem(menu, async () => statsText(await documentStats(this.api, id), this.t));
    if (this.readonly(protyle)) return;
    menu.addItem({ icon: "iconSyicCompress", label: this.t("compressDoc"), click: () => { void this.open("compress", protyle, undefined, id); } });
    menu.addItem({ icon: "iconEdit", label: this.t("renameDoc"), click: () => { void this.open("rename", protyle, undefined, id); } });
  }
  private infoItem(menu: subMenu, read: () => Promise<string>): void {
    menu.addItem({ type: "readonly", label: this.t("loadingInfo"), bind: node => {
      void read().then(text => {
        if (this.unloaded || !node.isConnected) return;
        const label = node.querySelector(".b3-menu__label") || node; label.textContent = text;
      }).catch(() => {
        if (!this.unloaded && node.isConnected) (node.querySelector(".b3-menu__label") || node).textContent = this.t("readFailed");
      });
    } });
  }
  private async dimensions(path: string, existing: HTMLImageElement | null): Promise<string> {
    if (existing?.naturalWidth) return `${existing.naturalWidth} × ${existing.naturalHeight}`;
    const image = new Image(); image.src = assetURL(path);
    try { await image.decode(); return `${image.naturalWidth} × ${image.naturalHeight}`; }
    catch { return this.t("unknownDimensions"); }
    finally { image.removeAttribute("src"); }
  }
  async onload(): Promise<void> {
    this.t = translator(this.i18n);
    this.unloaded = false;
    if (!["desktop", "desktop-window"].includes(getFrontend()) || this.readonly()) return;
    this.addIcons('<symbol id="iconSyicCompress" viewBox="0 0 32 32"><path d="M5 4h22a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1 3v18h20V7H6zm3 15 5-6 4 4 3-3 3 5H9zm1-11a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/></symbol>');
    this.manager = new JobManager(this.api, {
      load: async () => { const saved = await this.loadData("jobs.json"); return saved == null || saved === "" ? undefined : saved as Journal; },
      save: async journal => { await this.saveData("jobs.json", journal); },
    });
    try { await this.manager.initialize(); } catch (error) { this.loadError = error; }
    try { this.settings = loadSettings(await this.loadData("settings.json")); } catch { this.settings = loadSettings(undefined); }
    this.addTopBar({ icon: "iconSyicCompress", title: this.t("title"), position: "right", callback: () => { void this.open("compress"); } });
    for (const [kind, key] of [["compress", "compressDoc"], ["rename", "renameDoc"]] as const) {
      this.addCommand({ langKey: key, langText: this.t(key), execute: context => this.open(kind, context.protyle), callback: () => { void this.open(kind); } });
    }
    this.eventBus.on("open-menu-image", this.imageMenu);
    this.eventBus.on("click-editortitleicon", this.documentMenu);
    this.eventBus.on("open-menu-doctree", this.treeMenu);
  }
  private readonly(protyle?: IProtyle): boolean {
    const runtime = window as unknown as { siyuan?: { config?: { readonly?: boolean }; isPublish?: boolean } };
    return !!(runtime.siyuan?.config?.readonly || runtime.siyuan?.isPublish || protyle?.disabled);
  }
  private async open(kind: JobKind, context?: IProtyle, onlyPath?: string, documentId?: string): Promise<void> {
    if (!this.manager) return;
    if (this.loadError) { showMessage(this.t("invalidJournal"), 10000, "error"); return; }
    const protyle = context || (!documentId ? getActiveEditor()?.protyle : undefined);
    if (this.readonly(protyle)) { showMessage(this.t("readonly")); return; }
    if (this.manager.busy) { showMessage(this.t("busy")); return; }
    this.dialog?.destroy();
    this.dialog = new Dialog({ title: this.t("title"), content: '<div class="sy-imgcompression-root"></div>', width: "1100px", height: "82vh",
      destroyCallback: () => { this.panel?.dispose(); this.panel = undefined; this.dialog = undefined; } });
    const root = this.dialog.element.querySelector<HTMLElement>(".sy-imgcompression-root")!;
    this.panel = new AttachmentPanel(root, this.api, this.manager, this.t, documentId || protyle?.block.rootID || "", kind, onlyPath,
      { app: this.app, settings: this.settings, save: (key, profile) => this.saveProfile(key, profile) });
    try { await this.panel.start(); } catch (error) { showMessage(this.t(error instanceof UserError ? error.code : "error"), 7000, "error"); }
  }
  private saveProfile(key: "global" | "quick", profile: CompressionProfile): Promise<void> {
    const snapshot = cloneProfile(profile);
    this.settingsQueue = this.settingsQueue.catch(() => {}).then(async () => {
      const next = { ...this.settings, [key]: snapshot };
      await this.saveData("settings.json", next); this.settings[key] = snapshot;
    });
    return this.settingsQueue;
  }
  private openQuickSettings(): void {
    this.quickDialog?.destroy();
    const panel = quickSettingsDialog(this.settings.quick, this.t, async profile => {
      await this.saveProfile("quick", profile);
      if (!this.unloaded) showMessage(this.t("settingsSaved"));
    }, () => { if (this.quickDialog === panel) this.quickDialog = undefined; });
    this.quickDialog = panel;
  }
  private async quickCompress(protyle: IProtyle, path: string): Promise<void> {
    if (!this.manager || this.quickBusy || this.manager.busy) { showMessage(this.t("busy")); return; }
    if (this.loadError) { showMessage(this.t("invalidJournal"), 7000, "error"); return; }
    if (this.readonly(protyle)) { showMessage(this.t("readonly")); return; }
    this.quickBusy = true;
    const manager = this.manager, previous = manager.onProgress;
    const progress: typeof manager.onProgress = value => {
      previous?.(value); showMessage(`${this.t(value.stage)} ${value.done}/${value.total}`, 3000);
    };
    try {
      showMessage(this.t("scanning")); const options = cloneProfile(this.settings.quick).options;
      const doc = await scanDocument(this.api, protyle.block.rootID || "", path);
      if (this.unloaded) return;
      manager.onProgress = progress;
      const job = await manager.run(doc, "compress", options);
      const item = job.items[0];
      showMessage(`${this.t("quickCompress")} · ${this.t(item.error || item.state)}${item.state === "completed" ? ` · ${formatSize(item.originalSize)} → ${formatSize(item.resultSize!)}` : ""}`, 7000);
    } catch (error) { showMessage(this.t(error instanceof UserError ? error.code : "error"), 7000, "error"); }
    finally {
      this.quickBusy = false; if (manager.onProgress === progress) manager.onProgress = previous;
      await this.panel?.refreshExternal();
    }
  }
  onunload(): void {
    this.unloaded = true;
    this.eventBus.off("open-menu-image", this.imageMenu); this.eventBus.off("click-editortitleicon", this.documentMenu); this.eventBus.off("open-menu-doctree", this.treeMenu);
    this.manager?.cancel(); this.dialog?.destroy(); this.quickDialog?.destroy(); this.panel?.dispose();
  }
}

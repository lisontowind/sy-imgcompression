import { KernelError } from "../api";
import type { App } from "siyuan";
import { scanDocument } from "../core/assets";
import { assignRenamePaths, DEFAULT_RENAME, JobManager } from "../core/jobs";
import { imageRename, utf8Length } from "../core/naming";
import { assetURL, basename, isImageAttachment, isImageExtension } from "../core/paths";
import { Translator } from "../i18n";
import { AssetIdentity, CompressionOptions, CompressionProfile, DocumentAssets, JobKind, Kernel, PluginSettings, RenameOptions, UserError } from "../types";
import { cloneOptions, cloneProfile, defaultProfile } from "../core/settings";
import { outputDimensions, validateCompression } from "../compression/image-info";
import { profileEditor, optionsText } from "./profile";
import { ChildPanel, originalImage, referenceViewer } from "./viewers";
import { quickSettingsDialog } from "./quick-settings";
import { element, formatSize, statsText } from "./common";
export { formatSize } from "./common";

export class AttachmentPanel {
  private document?: DocumentAssets;
  private mode: JobKind;
  private working = false;
  private scanCancelled = false;
  private disposed = false;
  private profile = defaultProfile();
  private perImage = new Map<string, CompressionProfile>();
  private child?: ChildPanel;
  private previewChanged?: () => void;
  private previewRunning = false;
  private get options(): CompressionOptions { return this.profile.options; }
  private renameOptions: RenameOptions = { ...DEFAULT_RENAME };
  private filter = "all";
  private minBytes = 0;
  private historyLimit = 20;
  private tabs = element("div", "syic-tabs");
  private controls = element("div", "syic-controls");
  private summary = element("div", "syic-summary");
  private list = element("div", "syic-list");
  private status = element("div", "syic-status");
  private history = element("div", "syic-history");
  private scanButton: HTMLButtonElement;
  private applyButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  constructor(private root: HTMLElement, private kernel: Kernel, private manager: JobManager, private t: Translator,
    private documentId: string, mode: JobKind = "compress", private onlyPath?: string,
    private services?: { app?: App; settings: PluginSettings; save: (key: "global" | "quick", profile: CompressionProfile) => Promise<void> }) {
    this.profile = cloneProfile(services?.settings.global || defaultProfile());
    this.mode = mode; root.classList.add("syic");
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.scanButton = this.button(t("scan"), () => this.scan());
    this.applyButton = this.button(t("apply"), () => this.apply());
    this.cancelButton = this.button(t("cancel"), () => { this.scanCancelled = true; manager.cancel(); this.message(t("cancelHint")); });
    const actions = element("div", "syic-actions"); actions.append(this.scanButton, this.applyButton, this.cancelButton);
    this.applyButton.classList.add("syic-primary");
    root.append(this.tabs, this.controls, actions, this.status, this.summary, this.list,
      element("p", "syic-note", t("retained")), this.history);
    manager.onProgress = progress => this.message(`${t(progress.stage)} ${progress.done}/${progress.total} ${progress.path}`);
    manager.onChange = () => { if (!this.disposed) { this.renderHistory(); this.updateButtons(); } };
    this.renderTabs(); this.renderControls(); this.renderHistory(); this.updateButtons();
    if (manager.journal.jobs.some(job => job.state === "interrupted")) this.message(t("interruptedHint"));
  }
  async start(): Promise<void> { if (this.documentId) await this.scan(); else this.message(this.t("openDocument")); }
  async refreshExternal(): Promise<void> { if (!this.disposed && !this.working && !this.manager.busy) await this.scan(); }
  dispose(): void { this.disposed = true; this.releasePreview(); this.manager.onProgress = undefined; this.manager.onChange = undefined; }
  private releasePreview(): void { this.child?.destroy(); this.child = undefined; this.previewChanged = undefined; }
  private childPanel(title: string): ChildPanel {
    this.releasePreview();
    const panel = new ChildPanel(title, () => {
      if (this.child === panel) { this.child = undefined; this.previewChanged = undefined; }
      if (this.previewRunning) this.manager.cancel();
    });
    this.child = panel; return panel;
  }
  private button(label: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = element("button", "b3-button b3-button--outline", label); button.type = "button";
    button.addEventListener("click", () => { void Promise.resolve().then(action).catch(error => this.error(error)); }); return button;
  }
  private message(text: string, error = false): void { if (this.disposed) return; this.status.textContent = text; this.status.classList.toggle("syic-error", error); }
  private error(error: unknown): void {
    const key = error instanceof UserError ? error.code : "error";
    this.message(this.t(key) + (error instanceof UserError && error.detail ? `\n${error.detail}` : error instanceof KernelError ? `\n${error.message}` : key === "error" ? `\n${String(error)}` : ""), true);
  }
  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const [mode, label] of [["compress", "compress"], ["rename", "rename"]] as const) {
      const tab = this.button(this.t(label), () => {
        if (this.working || this.manager.busy) return;
        this.mode = mode; this.filter = "all"; this.minBytes = 0; this.releasePreview();
        if (this.onlyPath && mode === "rename") this.onlyPath = undefined;
        if (this.document) {
          assignRenamePaths(this.document.assets, this.document.title, this.renameOptions);
          for (const asset of this.document.assets) asset.selected = this.available(asset);
        }
        this.renderTabs(); this.renderControls(); this.renderList();
      });
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(mode === this.mode));
      tab.classList.toggle("syic-tab-active", mode === this.mode); tab.disabled = this.working || this.manager.busy; this.tabs.append(tab);
    }
    this.tabs.setAttribute("role", "tablist");
  }
  private field(label: string, input: HTMLElement, target = this.controls): void {
    input.setAttribute("aria-label", this.t(label));
    const wrapper = element("label", "syic-field"); wrapper.append(element("span", "", this.t(label)), input); target.append(wrapper);
  }
  private number(value: number, min: number, max: number, change: (value: number) => void): HTMLInputElement {
    const input = element("input", "b3-text-field"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1"; input.value = String(value);
    input.addEventListener("change", () => { change(input.valueAsNumber); this.releasePreview(); this.renderList(); }); return input;
  }
  private select(values: [string, string][], value: string, change: (value: string) => void): HTMLSelectElement {
    const input = element("select", "b3-select");
    values.forEach(([id, label]) => { const option = element("option", "", label); option.value = id; input.append(option); }); input.value = value;
    input.addEventListener("change", () => { change(input.value); this.releasePreview(); this.renderList(); }); return input;
  }
  private renderControls(): void {
    this.controls.replaceChildren();
    const tools = element("div", "syic-control-tools"), filters = element("div", "syic-filters");
    if (this.mode === "compress") {
      const selected = this.document?.assets.filter(asset => asset.selected) || [];
      const editor = element("div", "syic-profile syic-global-profile"); this.controls.append(editor);
      profileEditor(editor, this.profile, this.t, () => {
        this.previewChanged?.(); this.renderList();
        void this.services?.save("global", cloneProfile(this.profile)).catch(error => this.error(error));
      }, selected.length > 0 && selected.every(asset => asset.extension.toLowerCase() === ".png"));
      const quick = this.button(this.t("quickSettings"), () => this.editQuick());
      const reset = this.button(this.t("resetAllOverrides"), () => { this.perImage.clear(); this.previewChanged?.(); this.renderList(); });
      reset.classList.add("syic-quiet-button"); tools.append(quick, reset);
    } else {
      const prefix = this.renameInput(this.renameOptions.prefix || "image", value => {
        const unchanged = new Set(this.document?.assets.filter(asset => asset.newPath === asset.path) || []);
        this.renameOptions.prefix = value || "image";
        if (this.document) {
          assignRenamePaths(this.document.assets, this.document.title, this.renameOptions);
          const visible = new Set(this.visible());
          for (const asset of this.document.assets) {
            if (!this.available(asset)) asset.selected = false;
            else if (unchanged.has(asset) && visible.has(asset)) asset.selected = true;
          }
        }
      });
      prefix.placeholder = "image"; this.field("renamePrefix", prefix);
      this.controls.append(element("p", "syic-note", this.t("renameHint")), element("p", "syic-note", this.t("copiedOriginals")));
    }
    const deselectHidden = () => { const shown = new Set(this.visible()); this.document?.assets.forEach(asset => { if (!shown.has(asset)) asset.selected = false; }); };
    this.field("filterType", this.select([["all", this.t("allTypes")], ["images", this.t("images")], ["pdf", this.t("pdf")], ["other", this.t("other")]], this.filter, value => { this.filter = value; deselectHidden(); }), filters);
    this.field("minBytes", this.number(this.minBytes, 0, 100000, value => { this.minBytes = Number.isFinite(value) ? value : 0; deselectHidden(); }), filters);
    tools.append(filters); this.controls.append(tools);
  }
  private visible(): AssetIdentity[] {
    return this.document?.assets.filter(asset => {
      const image = isImageAttachment(asset.extension);
      return (!this.onlyPath || asset.path === this.onlyPath) && (this.mode !== "compress" || image) && utf8Length(asset.name) >= this.minBytes
        && (this.filter === "all" || (this.filter === "images" && image) || (this.filter === "pdf" && asset.extension.toLowerCase() === ".pdf") || (this.filter === "other" && !image && asset.extension.toLowerCase() !== ".pdf"));
    }) || [];
  }
  private renderList(): void {
    const scroll = this.list.scrollTop;
    this.list.replaceChildren(); this.summary.replaceChildren();
    if (!this.document) { this.updateButtons(); return; }
    try { if (this.mode === "rename") assignRenamePaths(this.document.assets, this.document.title, this.renameOptions); }
    catch (error) { this.error(error); this.applyButton.disabled = true; return; }
    this.summary.append(element("strong", "syic-doc-title", `${this.t("document")}: ${this.document.title}`));
    if (this.document.stats) this.summary.append(element("div", "syic-total", statsText(this.document.stats, this.t)));
    const visible = this.visible();
    if (!visible.length) this.list.append(element("p", "syic-note", this.t(this.document.stats?.count === 0 ? "noAttachments" : "empty")));
    const table = element("table", "syic-table"), head = element("thead"), header = element("tr");
    const selectHeader = element("th"), selectAll = element("input"); selectAll.type = "checkbox"; selectAll.setAttribute("aria-label", this.t("selectAll"));
    const available = (asset: AssetIdentity) => this.available(asset);
    selectAll.checked = visible.some(available) && visible.filter(available).every(x => x.selected);
    selectAll.addEventListener("change", () => { visible.forEach(asset => { if (available(asset)) asset.selected = selectAll.checked; }); this.renderControls(); this.renderList(); });
    selectHeader.append(selectAll); header.append(selectHeader);
    ["thumbnail", "name", ...(this.mode === "rename" ? ["newName"] : ["imageSettings"]), "size", "references", "status"].forEach(key => header.append(element("th", "", this.t(key))));
    head.append(header); table.append(head); const body = element("tbody");
    for (const asset of visible) {
      const row = element("tr"), selectCell = element("td"), checkbox = element("input"); checkbox.type = "checkbox"; checkbox.checked = asset.selected;
      const unsupportedImage = this.mode === "compress" && !isImageExtension(asset.extension);
      checkbox.disabled = !available(asset) || this.working || this.manager.busy; checkbox.setAttribute("aria-label", asset.name);
      checkbox.addEventListener("change", () => { asset.selected = checkbox.checked; this.renderControls(); this.renderList(); }); selectCell.append(checkbox);
      const thumb = element("td");
      if (isImageAttachment(asset.extension)) {
        const view = this.button(this.t("viewImage"), () => { originalImage(this.childPanel(asset.name).root, asset, this.t); });
        view.classList.add("syic-thumbnail-button"); view.setAttribute("aria-label", `${this.t("viewImage")}: ${asset.name}`);
        const img = element("img", "syic-thumbnail"); img.loading = "lazy"; img.alt = asset.name; img.src = assetURL(asset.path);
        img.addEventListener("error", () => { img.remove(); view.textContent = this.t("imageUnavailable"); }); view.replaceChildren(img); thumb.append(view);
      } else thumb.textContent = "—";
      const original = element("td", "syic-filename", asset.name); original.title = asset.path; row.append(selectCell, thumb, original);
      if (this.mode === "rename") {
        const cell = element("td", "syic-filename");
        if (isImageAttachment(asset.extension) && !asset.blockers.length) {
          const input = this.renameInput(asset.renameStem || "", value => {
            asset.renameStem = value || undefined;
            assignRenamePaths(this.document!.assets, this.document!.title, this.renameOptions);
            asset.selected = this.available(asset);
          }, asset);
          input.setAttribute("aria-label", `${this.t("individualName")}: ${asset.name}`);
          input.placeholder = this.renameOptions.prefix || "image"; input.disabled = this.working || this.manager.busy;
          cell.append(input, element("div", "syic-rename-target", asset.newPath ? basename(asset.newPath) : "—"));
          if (asset.renameStem) {
            const reset = this.button(this.t("inheritPrefix"), () => { asset.renameStem = undefined; assignRenamePaths(this.document!.assets, this.document!.title, this.renameOptions); asset.selected = this.available(asset); this.renderList(); });
            reset.disabled = this.working || this.manager.busy; cell.append(reset);
          }
        } else cell.textContent = "—";
        row.append(cell);
      }
      else {
        const config = element("td", "syic-item-config");
        if (isImageExtension(asset.extension)) {
          config.append(element("div", "syic-note", this.t(this.perImage.has(asset.path) ? "individual" : "inherited")), element("div", "", optionsText(this.effective(asset), this.t)));
          const edit = this.button(this.t("individualSettings"), () => this.editImage(asset)); edit.disabled = this.working || this.manager.busy; config.append(edit);
          if (this.perImage.has(asset.path)) { const reset = this.button(this.t("inheritGlobal"), () => { this.perImage.delete(asset.path); this.previewChanged?.(); this.renderList(); }); reset.disabled = this.working || this.manager.busy; config.append(reset); }
        } else config.textContent = "—";
        row.append(config);
      }
      row.append(element("td", "syic-nowrap", asset.sizeKnown === false ? this.t("unknownSize") : formatSize(asset.size)));
      const refs = element("td"); refs.append(this.button(`${this.t("details")} (${asset.references.length})`, () => { referenceViewer(this.childPanel(this.t("details")), asset, this.document!, this.services?.app, this.t, this.kernel); })); row.append(refs);
      const status = element("td");
      if (asset.blockers.length || unsupportedImage) status.textContent = asset.blockers.length ? asset.blockers.map(reason => this.t(reason)).join("; ") : this.t(/^\.(gif|apng)$/i.test(asset.extension) ? "animatedImage" : "unsupportedImage");
      else if (this.mode === "compress") { const button = this.button(this.t("preview"), () => this.preview(asset)); button.disabled = this.working || this.manager.busy; status.append(button); }
      else status.textContent = this.t(!isImageAttachment(asset.extension) ? "imagesOnly" : asset.newPath === asset.path ? "noChanges" : "ready");
      row.append(status); body.append(row);
    }
    table.append(body); this.list.append(table);
    const selected = this.document.assets.filter(asset => asset.selected && available(asset));
    const refs = selected.flatMap(asset => asset.references), books = new Set(refs.map(ref => ref.notebook).filter(Boolean));
    const docs = new Set(refs.map(ref => ref.rootID).filter(Boolean));
    this.summary.append(element("div", "syic-selected", this.t("selected", { count: selected.length })), element("div", "syic-impact", this.t("impact", {
      refs: refs.length, docs: docs.size, books: books.size, closed: this.document.notebooks.filter(book => book.closed && books.has(book.id)).length,
    })));
    this.updateButtons();
    this.list.scrollTop = scroll;
  }
  private available(asset: AssetIdentity): boolean {
    return !asset.blockers.length && (this.mode === "compress" ? isImageExtension(asset.extension) : isImageAttachment(asset.extension) && asset.newPath !== asset.path);
  }
  private renameInput(value: string, change: (value: string) => void, asset?: AssetIdentity): HTMLInputElement {
    const input = element("input", "b3-text-field syic-rename-input"); input.type = "text"; input.value = value;
    input.title = this.t("renameNameHint");
    const validate = () => {
      input.setCustomValidity(""); const name = input.value.normalize("NFC").trim();
      try {
        const targets = asset ? [asset] : this.document?.assets.filter(item => isImageAttachment(item.extension) && !item.renameStem) || [];
        for (const item of targets.length ? targets : [{ name: "image.png", extension: ".png" }]) imageRename(item.name, item.extension, "20261016000000-abcdefg", name || (asset ? this.renameOptions.prefix : undefined) || "image");
        input.removeAttribute("aria-invalid"); return name;
      } catch {
        input.setCustomValidity(this.t("invalidFilename")); input.setAttribute("aria-invalid", "true"); return undefined;
      }
    };
    input.addEventListener("input", () => { validate(); this.updateButtons(); });
    input.addEventListener("change", () => {
      const name = validate(); if (name === undefined) { input.reportValidity(); this.updateButtons(); return; }
      change(name); input.value = asset ? name : name || "image"; this.renderList();
    }); return input;
  }
  private updateButtons(): void {
    if (this.disposed) return;
    const busy = this.working || this.manager.busy;
    this.scanButton.disabled = busy; this.cancelButton.disabled = !busy;
    this.applyButton.disabled = busy || !!this.root.querySelector("input:invalid") || !this.document?.assets.some(asset => asset.selected && this.available(asset));
    this.controls.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach(input => { input.disabled = busy || input.dataset.locked === "true"; });
    this.tabs.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = busy; });
    if (busy) this.list.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(node => { node.disabled = true; });
    this.history.querySelectorAll<HTMLButtonElement>("button").forEach(node => { node.disabled = busy; });
  }
  private async scan(): Promise<void> {
    if (this.working || this.manager.busy) return;
    this.working = true; this.scanCancelled = false; this.document = undefined; this.perImage.clear(); this.releasePreview(); this.renderList(); this.message(this.t("scanning"));
    try {
      const scanned = await scanDocument(this.kernel, this.documentId, undefined, path => {
        if (this.scanCancelled) throw new UserError("cancelled");
        this.message(`${this.t("scanning")} ${path}`);
      });
      if (this.disposed) return;
      if (this.scanCancelled) throw new UserError("cancelled");
      this.document = scanned;
      assignRenamePaths(scanned.assets, scanned.title, this.renameOptions);
      this.document.assets.forEach(asset => { if (!this.available(asset)) asset.selected = false; });
      const shown = new Set(this.visible()); this.document.assets.forEach(asset => { if (!shown.has(asset)) asset.selected = false; });
      this.message(this.t(scanned.stats?.count === 0 ? "noAttachments" : "ready"));
    } catch (error) { this.error(error); }
    finally { this.working = false; this.renderControls(); this.renderList(); this.updateButtons(); }
  }
  private effective(asset: AssetIdentity): CompressionOptions { return cloneOptions(this.perImage.get(asset.path)?.options || this.options); }
  private editQuick(): void {
    this.releasePreview();
    const panel = quickSettingsDialog(this.services?.settings.quick || defaultProfile(), this.t, async profile => {
      await this.services?.save("quick", profile); this.message(this.t("settingsSaved"));
    }, () => { if (this.child === panel) this.child = undefined; });
    this.child = panel;
  }
  private editImage(asset: AssetIdentity): void {
    const panel = this.childPanel(`${this.t("individualSettings")} · ${asset.name}`);
    const profile = cloneProfile(this.perImage.get(asset.path) || this.profile);
    const controls = element("div", "syic-profile"), expected = element("p", "syic-expected");
    panel.root.append(controls, expected); const image = originalImage(panel.root, asset, this.t);
    const update = () => {
      if (!image.naturalWidth) return;
      const size = outputDimensions(image.naturalWidth, image.naturalHeight, profile.options);
      expected.textContent = `${image.naturalWidth} × ${image.naturalHeight} → ${size[0]} × ${size[1]}`;
    };
    image.addEventListener("load", update); profileEditor(controls, profile, this.t, update, asset.extension.toLowerCase() === ".png");
    panel.root.append(this.button(this.t("saveSettings"), () => {
      validateCompression(profile.options); this.perImage.set(asset.path, cloneProfile(profile)); panel.destroy(); this.renderList();
    }));
  }
  private preview(asset: AssetIdentity): void {
    if (this.working || this.manager.busy) return;
    const panel = this.childPanel(`${this.t("preview")} · ${asset.name}`), controls = element("div", "syic-profile");
    const expected = element("p", "syic-expected"), state = element("p", "syic-preview-state"), resultArea = element("div", "syic-preview");
    panel.root.append(controls, expected); const image = originalImage(panel.root, asset, this.t);
    let profile = cloneProfile(this.perImage.get(asset.path) || this.profile), version = 0;
    let resultUrls: string[] = [];
    const clear = () => { resultUrls.forEach(url => URL.revokeObjectURL(url)); resultUrls = []; resultArea.replaceChildren(); };
    panel.own(clear);
    const updateDimensions = () => {
      if (image.naturalWidth) {
        const size = outputDimensions(image.naturalWidth, image.naturalHeight, profile.options);
        expected.textContent = `${image.naturalWidth} × ${image.naturalHeight} → ${size[0]} × ${size[1]}`;
      }
    };
    const update = () => {
      if (panel.closed) return;
      version++; clear(); state.textContent = this.t("previewStale"); updateDimensions();
    };
    this.previewChanged = () => {
      profile = cloneProfile(this.perImage.get(asset.path) || this.profile);
      profileEditor(controls, profile, this.t, change, asset.extension.toLowerCase() === ".png"); update();
    };
    const change = () => { this.perImage.set(asset.path, cloneProfile(profile)); update(); this.renderList(); };
    image.addEventListener("load", updateDimensions);
    profileEditor(controls, profile, this.t, change, asset.extension.toLowerCase() === ".png");
    const generate = this.button(this.t("generatePreview"), async () => {
      if (this.working || this.manager.busy || panel.closed) return;
      validateCompression(profile.options); const token = ++version; clear();
      this.previewRunning = this.working = true; this.updateButtons(); generate.disabled = true;
      controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(node => { node.disabled = true; });
      state.textContent = this.t("preparing");
      try {
        const { source, result } = await this.manager.preview(asset, cloneOptions(profile.options));
        if (this.disposed || panel.closed || token !== version) return;
        for (const [title, bytes] of [[this.t("before"), source], [this.t("after"), result.bytes]] as const) {
          const figure = element("figure"), img = element("img"); img.alt = title;
          const url = URL.createObjectURL(new Blob([bytes])); resultUrls.push(url); img.src = url;
          figure.append(img, element("figcaption", "", `${title} · ${formatSize(bytes.byteLength)}`)); resultArea.append(figure);
        }
        const reduction = Math.max(0, source.byteLength - result.bytes.byteLength);
        state.textContent = `${result.originalWidth} × ${result.originalHeight} → ${result.width} × ${result.height}\n${this.t("savings", { size: formatSize(reduction), percent: (reduction / source.byteLength * 100).toFixed(1) })}${reduction === 0 ? ` · ${this.t("noSavings")}` : ""}`;
        this.message(state.textContent);
      } catch (error) { if (!panel.closed) state.textContent = this.t(error instanceof UserError ? error.code : "error") + `\n${String(error)}`; }
      finally {
        this.previewRunning = this.working = false;
        if (!panel.closed) { generate.disabled = false; controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(node => { node.disabled = node.dataset.locked === "true"; }); }
        if (!this.disposed) { this.renderList(); this.updateButtons(); }
      }
    });
    panel.root.append(generate, state, resultArea); state.textContent = this.t("previewClickHint");
  }
  private async apply(): Promise<void> {
    if (!this.document || this.working || this.manager.busy) return;
    const invalid = this.root.querySelector<HTMLInputElement>("input:invalid"); if (invalid) { invalid.reportValidity(); return; }
    this.working = true; this.updateButtons(); this.releasePreview();
    try {
      // Compression must never rename non-images selected on the auxiliary tab.
      if (this.mode === "compress") this.document.assets.forEach(asset => { if (!isImageExtension(asset.extension)) asset.selected = false; });
      const job = await this.manager.run(this.document, this.mode, this.mode === "compress" ? cloneOptions(this.options) : { ...this.renameOptions }, new Map([...this.perImage].map(([path, profile]) => [path, cloneOptions(profile.options)])));
      const saved = job.items.filter(item => item.state === "completed").reduce((sum, item) => sum + Math.max(0, item.originalSize - (item.resultSize ?? item.originalSize)), 0);
      this.message(`${this.t(job.state)}${this.mode === "compress" ? ` · ${this.t("savings", { size: formatSize(saved), percent: (saved / Math.max(1, job.items.reduce((s, i) => s + i.originalSize, 0)) * 100).toFixed(1) })}` : ""}`);
    } catch (error) { this.error(error); }
    finally { await this.refreshAfterJob(); }
  }
  private async refreshAfterJob(): Promise<void> {
    this.perImage.clear();
    try {
      const scanned = await scanDocument(this.kernel, this.documentId);
      if (!this.disposed) { this.document = scanned; assignRenamePaths(scanned.assets, scanned.title, this.renameOptions); scanned.assets.forEach(asset => { asset.selected = false; }); }
    } catch { this.document = undefined; this.message(this.t("refreshNeeded")); }
    finally { this.working = false; if (!this.disposed) { this.renderList(); this.renderHistory(); this.updateButtons(); } }
  }
  private renderHistory(): void {
    const expanded = new Set([...this.history.querySelectorAll<HTMLDetailsElement>("details[data-job-id][open]")].map(node => node.dataset.jobId));
    this.history.replaceChildren(element("h3", "", this.t("history")));
    for (const job of this.manager.journal.jobs.slice(0, this.historyLimit)) {
      const details = element("details"), summary = element("summary", "", `${new Date(job.created).toLocaleString()} · ${job.documentTitle} · ${this.t(job.kind === "compress" ? "compress" : "rename")} · ${this.t(job.state)}`);
      details.dataset.jobId = job.id; details.open = expanded.has(job.id);
      details.append(summary);
      for (const item of job.items) {
        const text = element("div", "syic-job-item", `${this.t(item.state)} · ${item.oldPath}\n→ ${item.newPath || "—"}${item.error ? `\n${this.t(item.error)}` : ""}`); details.append(text);
      }
      if (job.items.some(item => ["completed", "applying", "recovery-required"].includes(item.state))) {
        const restore = this.button(this.t("restore"), async () => {
          if (this.working || this.manager.busy) return;
          this.working = true; this.updateButtons();
          try { await this.manager.restore(job); this.message(this.t("restored")); }
          catch (error) { this.error(error); }
          finally { await this.refreshAfterJob(); }
        }); restore.disabled = this.working || this.manager.busy; details.append(restore);
      }
      this.history.append(details);
    }
    if (this.manager.journal.jobs.length > this.historyLimit) {
      this.history.append(this.button(this.t("moreHistory"), () => { this.historyLimit += 20; this.renderHistory(); }));
    }
  }
}

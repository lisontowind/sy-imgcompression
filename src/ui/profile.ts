import { Translator } from "../i18n";
import { CompressionOptions, CompressionProfile, ResizeMode } from "../types";
import { element } from "./common";
import { cloneOptions } from "../core/settings";

export function optionsText(options: CompressionOptions, t: Translator): string {
  const size = options.resize;
  const resize = !size ? `${options.maxWidth || "∞"} × ${options.maxHeight || "∞"} px`
    : size.mode === "original" ? t("originalSize") : size.mode === "percent" ? `${size.value}%` : `${t(size.mode)} ${size.value} px`;
  return `${options.format === "original" ? t("originalFormat") : "WebP"} · ${t("quality")} ${options.quality} · ${resize}`;
}

/** The explicit preset survives even when custom quality equals a named preset. */
export function profileEditor(root: HTMLElement, profile: CompressionProfile, t: Translator, changed: () => void, pngOnly = false): void {
  const resize = profile.options.resize;
  let sizeChoice = !resize ? "legacy" : resize.mode === "percent" ? ([75, 50, 25].includes(resize.value) ? String(resize.value) : "custom") : resize.mode;
  const field = (key: string, input: HTMLElement) => {
    input.setAttribute("aria-label", t(key)); const label = element("label", "syic-field"); label.append(element("span", "", t(key)), input); root.append(label);
  };
  const select = (values: [string, string][], value: string, update: (value: string) => void) => {
    const node = element("select", "b3-select");
    for (const [id, label] of values) { const option = element("option", "", label); option.value = id; node.append(option); }
    node.value = value; node.addEventListener("change", () => { update(node.value); render(); changed(); }); return node;
  };
  const number = (value: number, max: number, update: (value: number) => void) => {
    const node = element("input", "b3-text-field"); node.type = "number"; node.min = "1"; node.max = String(max); node.step = "1"; node.value = String(value);
    node.addEventListener("change", () => {
      if (!Number.isInteger(node.valueAsNumber) || node.valueAsNumber < 1 || node.valueAsNumber > max) { node.reportValidity(); node.value = String(value); return; }
      update(node.valueAsNumber); render(); changed();
    }); return node;
  };
  const render = () => {
    root.replaceChildren();
    field("preset", select([["90", t("clear")], ["82", t("balanced")], ["70", t("small")], ["custom", t("custom")]], profile.preset, value => {
      profile.preset = value as CompressionProfile["preset"]; if (value !== "custom") profile.options.quality = Number(value);
    }));
    field("format", select([["webp", "WebP"], ["original", t("originalFormat")]], profile.options.format, value => { profile.options.format = value as CompressionOptions["format"]; }));
    const quality = number(profile.options.quality, 100, value => { profile.options.quality = value; profile.preset = "custom"; });
    if (pngOnly && profile.options.format === "original") { quality.disabled = true; quality.dataset.locked = "true"; }
    field("quality", quality);
    const sizes: [string, string][] = [["original", t("originalSize")], ["75", "75%"], ["50", "50%"], ["25", "25%"], ["custom", t("customPercent")], ["width", t("advancedWidth")], ["height", t("advancedHeight")], ["longestEdge", t("advancedEdge")]];
    if (sizeChoice === "legacy") sizes.push(["legacy", t("legacySize")]);
    field("resizeMode", select(sizes, sizeChoice, value => {
      sizeChoice = value;
      const mode: ResizeMode = ["75", "50", "25", "custom"].includes(value) ? "percent" : value as ResizeMode;
      profile.options.resize = { mode, value: ["75", "50", "25"].includes(value) ? Number(value) : value === "custom" || value === "original" ? 100 : 1920 };
      profile.options.maxWidth = profile.options.maxHeight = 0;
    }));
    if (sizeChoice === "custom" || ["width", "height", "longestEdge"].includes(sizeChoice)) {
      const size = profile.options.resize!;
      field(sizeChoice === "custom" ? "percentValue" : "pixelValue", number(size.value, sizeChoice === "custom" ? 100 : 100000, value => { size.value = value; }));
    }
    root.append(element("p", "syic-note", t("aspectHint")));
    if (profile.options.format === "original") root.append(element("p", "syic-note", t("pngQualityHint")));
  };
  profile.options = cloneOptions(profile.options); render();
}

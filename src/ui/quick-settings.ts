import { cloneQuickProfile } from "../core/settings";
import { validateCompression } from "../compression/image-info";
import { Translator } from "../i18n";
import { QuickCompressionProfile, UserError } from "../types";
import { element, button } from "./common";
import { profileEditor } from "./profile";
import { ChildPanel } from "./viewers";

/** Shared by the main panel and image context menu; never opens the attachment list. */
export function quickSettingsDialog(profile: QuickCompressionProfile, t: Translator, save: (profile: QuickCompressionProfile) => Promise<void>, closed: () => void = () => {}): ChildPanel {
  const panel = new ChildPanel(t("quickSettings"), closed, { width: "720px", height: "auto" });
  panel.root.classList.add("syic-quick-settings");
  const draft = cloneQuickProfile(profile), group = element("fieldset", "syic-settings-box"), controls = element("div", "syic-profile");
  const mode = element("select", "b3-select"); mode.setAttribute("aria-label", t("processingMode"));
  for (const value of ["in-place", "document", "workspace"] as const) {
    const option = element("option", "", t("mode-" + value)); option.value = value; mode.append(option);
  }
  mode.value = draft.mode;
  const modeField = element("label", "syic-field"), hint = element("p", "syic-note");
  modeField.append(element("span", "", t("processingMode")), mode);
  const render = () => {
    if (draft.mode === "in-place") draft.options.format = "original";
    hint.textContent = t("modeHint-" + draft.mode);
    profileEditor(controls, draft, t, () => {}, false, draft.mode === "in-place", draft.mode === "in-place");
  };
  mode.addEventListener("change", () => { draft.mode = mode.value as QuickCompressionProfile["mode"]; render(); });
  group.append(element("legend", "", t("quickSettingsGroup")), modeField, hint, controls, element("p", "syic-note", t("quickHint"))); render();
  const status = element("p", "syic-status"); status.setAttribute("role", "status");
  const error = (error: unknown) => { if (!panel.closed) { status.textContent = t(error instanceof UserError ? error.code : "error"); status.classList.add("syic-error"); } };
  const actions = element("div", "syic-actions");
  const apply = button(t("saveSettings"), async () => {
    if (apply.disabled) return;
    const invalid = controls.querySelector<HTMLInputElement>("input:invalid"); if (invalid) { invalid.reportValidity(); return; }
    validateCompression(draft.options); apply.disabled = true;
    mode.disabled = true; controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(node => { node.disabled = true; });
    try { await save(cloneQuickProfile(draft)); panel.destroy(); }
    finally { if (!panel.closed) { apply.disabled = false; mode.disabled = false; controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(node => { node.disabled = node.dataset.locked === "true"; }); } }
  }, error);
  apply.classList.add("syic-primary");
  const cancel = button(t("closeSettings"), () => panel.destroy(), error);
  actions.append(cancel, apply); panel.root.append(group, status, actions); return panel;
}

import { cloneProfile } from "../core/settings";
import { validateCompression } from "../compression/image-info";
import { Translator } from "../i18n";
import { CompressionProfile, UserError } from "../types";
import { element, button } from "./common";
import { profileEditor } from "./profile";
import { ChildPanel } from "./viewers";

/** Shared by the main panel and image context menu; never opens the attachment list. */
export function quickSettingsDialog(profile: CompressionProfile, t: Translator, save: (profile: CompressionProfile) => Promise<void>, closed: () => void = () => {}): ChildPanel {
  const panel = new ChildPanel(t("quickSettings"), closed, { width: "720px", height: "auto" });
  panel.root.classList.add("syic-quick-settings");
  const draft = cloneProfile(profile), group = element("fieldset", "syic-settings-box"), controls = element("div", "syic-profile");
  group.append(element("legend", "", t("quickSettingsGroup")), controls, element("p", "syic-note", t("quickHint")));
  profileEditor(controls, draft, t, () => {});
  const status = element("p", "syic-status"); status.setAttribute("role", "status");
  const error = (error: unknown) => { if (!panel.closed) { status.textContent = t(error instanceof UserError ? error.code : "error"); status.classList.add("syic-error"); } };
  const actions = element("div", "syic-actions");
  const apply = button(t("saveSettings"), async () => {
    if (apply.disabled) return;
    const invalid = controls.querySelector<HTMLInputElement>("input:invalid"); if (invalid) { invalid.reportValidity(); return; }
    validateCompression(draft.options); apply.disabled = true;
    controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(node => { node.disabled = true; });
    try { await save(cloneProfile(draft)); panel.destroy(); }
    finally { if (!panel.closed) { apply.disabled = false; controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(node => { node.disabled = node.dataset.locked === "true"; }); } }
  }, error);
  apply.classList.add("syic-primary");
  const cancel = button(t("closeSettings"), () => panel.destroy(), error);
  actions.append(cancel, apply); panel.root.append(group, status, actions); return panel;
}

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { quickSettingsDialog } from "../src/ui/quick-settings";
import { loadSettings } from "../src/core/settings";
import { translator } from "../src/i18n";
import { Dialog } from "./siyuan-host";

afterEach(() => { for (const dialog of Dialog.instances) dialog.destroy(); Dialog.instances.length = 0; });
function change(root: HTMLElement, label: string, value: string) {
  const input = root.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  input.value = value; input.dispatchEvent(new Event("change", { bubbles: true }));
}
it("persists the quick mode and format independently and constrains overwrites", async () => {
  const settings = loadSettings(undefined), save = vi.fn(async (_profile: unknown) => {});
  const panel = quickSettingsDialog(settings.quick, translator({}), save);
  const format = () => panel.root.querySelector<HTMLSelectElement>('[aria-label="Output format"]')!;
  expect(format().options[1].disabled).toBe(true);
  change(panel.root, "Processing mode", "document"); expect(format().options[1].disabled).toBe(false);
  change(panel.root, "Output format", "webp");
  expect(panel.root.textContent).not.toContain("Existing WebP images are compressed in place");
  panel.root.querySelector<HTMLButtonElement>(".syic-primary")!.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({ mode: "document", options: { format: "webp" } });
  expect(settings.quick).toMatchObject({ mode: "in-place", options: { format: "original" } });
  const again = quickSettingsDialog({ ...settings.quick, mode: "workspace", options: { ...settings.quick.options, format: "webp" } }, translator({}), save);
  change(again.root, "Processing mode", "in-place");
  expect(again.root.querySelector<HTMLSelectElement>('[aria-label="Output format"]')!.value).toBe("original");
  expect(again.root.textContent).toContain("All documents sharing");
});
it("retains a failed save draft and re-enables the mode selector", async () => {
  const save = vi.fn(async () => { throw new Error("disk full"); });
  const panel = quickSettingsDialog(loadSettings(undefined).quick, translator({}), save);
  change(panel.root, "Processing mode", "document"); change(panel.root, "Output format", "webp");
  panel.root.querySelector<HTMLButtonElement>(".syic-primary")!.click();
  await vi.waitFor(() => expect(panel.root.querySelector(".syic-status")!.textContent).toContain("Could not complete"));
  expect(panel.root.querySelector<HTMLSelectElement>('[aria-label="Processing mode"]')!.disabled).toBe(false);
  expect(panel.root.querySelector<HTMLSelectElement>('[aria-label="Output format"]')!.value).toBe("webp");
});

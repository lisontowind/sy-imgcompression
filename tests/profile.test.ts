// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { cloneProfile, defaultProfile, loadSettings } from "../src/core/settings";
import { profileEditor } from "../src/ui/profile";
import { translator } from "../src/i18n";

const t = translator({});
function change(root: HTMLElement, label: string, value: string) {
  const node = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  node.value = value; node.dispatchEvent(new Event("change", { bubbles: true }));
}
it("keeps explicit custom selection when quality equals a named preset", () => {
  const root = document.createElement("div"), profile = defaultProfile(), changed = vi.fn();
  profileEditor(root, profile, t, changed);
  change(root, "Preset", "custom");
  expect(profile.preset).toBe("custom"); expect(root.querySelector<HTMLSelectElement>("select")!.value).toBe("custom");
  change(root, "Quality", "90"); expect(profile.preset).toBe("custom");
  change(root, "Preset", "70"); expect(profile.options.quality).toBe(70); expect(changed).toHaveBeenCalledTimes(3);
});
it("offers percentage and single pixel controls while preserving PNG lossless state", () => {
  const root = document.createElement("div"), profile = defaultProfile(); profileEditor(root, profile, t, () => {}, true);
  change(root, "Resize mode", "custom"); change(root, "Scale (%)", "60");
  expect(profile.options.resize).toEqual({ mode: "percent", value: 60 });
  change(root, "Resize mode", "longestEdge"); change(root, "Pixel limit (px)", "1200");
  expect(root.querySelector('[aria-label="Scale (%)"]')).toBeNull(); expect(profile.options.resize).toEqual({ mode: "longestEdge", value: 1200 });
  change(root, "Output format", "original"); expect(root.querySelector<HTMLInputElement>('[aria-label="Quality"]')!.disabled).toBe(true);
});
it("keeps persisted quick/global profiles independent and rejects invalid settings", () => {
  const settings = loadSettings(undefined); settings.global.options.resize!.value = 50;
  expect(settings.quick.options.resize!.value).toBe(100);
  const copy = loadSettings(JSON.parse(JSON.stringify(settings))); expect(copy.global).toEqual(settings.global);
  const draft = cloneProfile(copy.quick); draft.options.quality = 10; expect(copy.quick.options.quality).toBe(82);
  expect(loadSettings({ schema: 1, quick: { preset: "custom", options: { quality: -1 } } }).quick).toEqual(defaultProfile());
});

import { CompressionOptions, CompressionProfile, PluginSettings, QuickCompressionProfile } from "../types";
import { validateCompression } from "../compression/image-info";

export const cloneOptions = (value: CompressionOptions): CompressionOptions => ({ ...value, ...(value.resize ? { resize: { ...value.resize } } : {}) });
export const defaultProfile = (): CompressionProfile => ({ preset: "82", options: { quality: 82, format: "original", maxWidth: 0, maxHeight: 0, resize: { mode: "original", value: 100 } } });
export function cloneProfile(profile: CompressionProfile): CompressionProfile { return { preset: profile.preset, options: cloneOptions(profile.options) }; }
export function cloneQuickProfile(profile: QuickCompressionProfile): QuickCompressionProfile { return { ...cloneProfile(profile), mode: profile.mode }; }
export function loadSettings(value: unknown): PluginSettings {
  const fallback: PluginSettings = { schema: 1, global: defaultProfile(), quick: { ...defaultProfile(), mode: "in-place" } };
  if (!value || typeof value !== "object" || (value as PluginSettings).schema !== 1) return fallback;
  for (const key of ["global", "quick"] as const) {
    const profile = (value as PluginSettings)[key];
    try {
      if (!profile || !["90", "82", "70", "custom"].includes(profile.preset)) continue;
      validateCompression(profile.options);
      if (key === "global") fallback.global = cloneProfile(profile);
      else {
        const mode = (profile as QuickCompressionProfile).mode;
        fallback.quick = { ...cloneProfile(profile), mode: ["in-place", "document", "workspace"].includes(mode) ? mode : profile.options.format === "webp" ? "workspace" : "in-place" };
        if (fallback.quick.mode === "in-place") fallback.quick.options.format = "original";
      }
    } catch { /* Invalid settings do not make recovery journals inaccessible. */ }
  }
  return fallback;
}

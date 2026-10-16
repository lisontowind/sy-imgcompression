import { CompressionOptions, CompressionProfile, PluginSettings } from "../types";
import { validateCompression } from "../compression/image-info";

export const cloneOptions = (value: CompressionOptions): CompressionOptions => ({ ...value, ...(value.resize ? { resize: { ...value.resize } } : {}) });
export const defaultProfile = (): CompressionProfile => ({ preset: "82", options: { quality: 82, format: "webp", maxWidth: 0, maxHeight: 0, resize: { mode: "original", value: 100 } } });
export function cloneProfile(profile: CompressionProfile): CompressionProfile { return { preset: profile.preset, options: cloneOptions(profile.options) }; }
export function loadSettings(value: unknown): PluginSettings {
  const fallback: PluginSettings = { schema: 1, global: defaultProfile(), quick: defaultProfile() };
  if (!value || typeof value !== "object" || (value as PluginSettings).schema !== 1) return fallback;
  for (const key of ["global", "quick"] as const) {
    const profile = (value as PluginSettings)[key];
    try {
      if (!profile || !["90", "82", "70", "custom"].includes(profile.preset)) continue;
      validateCompression(profile.options); fallback[key] = cloneProfile(profile);
    } catch { /* Invalid settings do not make recovery journals inaccessible. */ }
  }
  return fallback;
}

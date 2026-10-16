import { UserError } from "../types";

const encoder = new TextEncoder();
export const utf8Length = (value: string): number => encoder.encode(value).length;
const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function truncateUTF8(value: string, budget: number): string {
  if (!Number.isInteger(budget) || budget < 1 || budget > 120) throw new UserError("invalidByteLimit");
  let result = "", used = 0;
  for (const { segment } of segments.segment(value)) {
    const bytes = utf8Length(segment);
    if (used + bytes > budget) break;
    result += segment; used += bytes;
  }
  return result;
}

function truncatePrefix(value: string, budget: number): string {
  // The UTF-8 ceiling still applies. ASCII costs 1.5 budget units, so the default
  // 24 fits 16 English characters or 8 common Chinese characters. Double costs
  // internally to keep mixed-text calculations integral.
  const bounded = truncateUTF8(value, budget);
  let result = "", used = 0;
  for (const { segment } of segments.segment(bounded)) {
    const cost = Math.max(3, utf8Length(segment) * 2);
    if (used + cost > budget * 2) break;
    result += segment; used += cost;
  }
  return result;
}

export function documentPrefix(title: string, budget = 24): string {
  let value = title.normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").replace(/-+/g, "-")
    .trim().replace(/[. ]+$/g, "");
  if (reserved.test(value)) value = "_" + value;
  value = truncatePrefix(value, budget).trim().replace(/[. ]+$/g, "");
  if (!value) value = truncatePrefix("doc", budget) || "d";
  if (reserved.test(value)) value = truncatePrefix("_" + value, budget);
  return value;
}

export function sequenceName(title: string, index: number, budget = 24): string {
  if (!Number.isSafeInteger(index) || index < 1) throw new UserError("invalidSequence");
  return `${documentPrefix(title, budget)}-${String(index).padStart(3, "0")}`;
}

export function validateFilename(name: string): void {
  if (!name || name === "." || name === ".." || /[\/\\:*?"<>|\u0000-\u001f\u007f]/.test(name)
      || /[. ]$/.test(name) || reserved.test(name) || utf8Length(name) > 240) {
    throw new UserError("invalidFilename", name);
  }
}

export function newNodeId(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const suffix: string[] = [];
  // Rejection sampling keeps all 36 characters equally likely.
  while (suffix.length < 7) {
    for (const n of crypto.getRandomValues(new Uint8Array(16))) {
      if (n < 252) suffix.push(alphabet[n % 36]);
      if (suffix.length === 7) break;
    }
  }
  return `${stamp}-${suffix.join("")}`;
}

export function fullRename(title: string, index: number, extension: string, budget = 24, id = newNodeId()): string {
  if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new UserError("invalidFilename", id);
  const filename = `${sequenceName(title, index, budget)}-${id}${extension}`;
  validateFilename(filename);
  return filename;
}

/** Only a complete terminal SiYuan ID is preserved; dots/extensions are separate. */
export function imageRename(name: string, extension: string, fallbackId?: string, prefix = "image"): string {
  const stem = extension ? name.slice(0, -extension.length) : name;
  const id = stem.match(/(?:^|-)(\d{14}-[a-z0-9]{7})$/)?.[1] || fallbackId || newNodeId();
  const normalized = prefix.normalize("NFC").trim();
  validateFilename(normalized);
  const filename = `${normalized}-${id}${extension}`;
  validateFilename(filename);
  return filename;
}

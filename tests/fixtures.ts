import { AssetReference, ReferenceReport } from "../src/types";
export const ref = (blockID = "block1", reference = "assets/a.png"): AssetReference => ({ type: "link", notebook: "notebook", rootID: "doc", path: "/doc.sy", blockID, avID: "", valueID: "", reference, replacement: "", relinkable: true, reason: "" });
export const report = (references: AssetReference[] = []): ReferenceReport => ({ references, skippedNotebooks: [], dryRun: true, historyPath: "", updated: 0 });
export function png(width = 16, height = 12, animated = false): ArrayBuffer {
  const b = new Uint8Array(animated ? 65 : 45), d = new DataView(b.buffer);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]); d.setUint32(8, 13); b.set(new TextEncoder().encode("IHDR"), 12);
  d.setUint32(16, width); d.setUint32(20, height); b[24] = 8; b[25] = 6;
  let offset = 33;
  if (animated) { d.setUint32(offset, 8); b.set(new TextEncoder().encode("acTL"), offset + 4); offset += 20; }
  b.set(new TextEncoder().encode("IEND"), offset + 4); return b.buffer;
}

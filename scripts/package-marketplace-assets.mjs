import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

const root = path.resolve(import.meta.dirname, "..");
for (const name of ["icon.png", "preview.png", "assets/marketing/header.png", "assets/marketing/header-en.png", "assets/guide/manifest.json", "assets/guide/en/manifest.json", "assets/branding/prompts.json"]) {
  if (!fs.existsSync(path.join(root, name))) throw new Error("Missing deliverable: " + name);
}
const output = fs.createWriteStream(path.join(root, "marketplace-materials.zip"));
const archive = archiver("zip", { zlib: { level: 9 } });
const complete = new Promise((resolve, reject) => { output.on("close", resolve); output.on("error", reject); archive.on("error", reject); });
archive.pipe(output);
archive.file(path.join(root, "icon.png"), { name: "icon.png" });
archive.file(path.join(root, "preview.png"), { name: "preview.png" });
archive.directory(path.join(root, "assets"), "assets");
await archive.finalize(); await complete;
console.log(`marketplace-materials.zip: ${archive.pointer()} bytes`);

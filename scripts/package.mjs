import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import archiver from "archiver";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const licenses = path.join(root, "dist", "licenses"); fs.mkdirSync(licenses, { recursive: true });
for (const name of ["@jsquash/webp", "@jsquash/jpeg", "@jsquash/png", "@jsquash/oxipng", "@jsquash/resize", "wasm-feature-detect"]) {
  const directory = path.dirname(require.resolve(`${name}/package.json`));
  const out = path.join(licenses, name.replace("/", "-")); fs.mkdirSync(out, { recursive: true });
  function copy(dir, relative = "") {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      if (file.name === "node_modules") continue;
      const source = path.join(dir, file.name), target = path.join(out, relative, file.name);
      if (file.isDirectory()) copy(source, path.join(relative, file.name));
      else if (/license|copying|notice|authors/i.test(file.name)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
    }
  }
  copy(directory);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  fs.writeFileSync(path.join(out, "package-info.json"), JSON.stringify({ name, version: pkg.version, license: pkg.license, repository: pkg.repository }, null, 2));
}
const output = fs.createWriteStream(path.join(root, "package.zip"));
const archive = archiver("zip", { zlib: { level: 9 } });
const complete = new Promise((resolve, reject) => { output.on("close", resolve); output.on("error", reject); archive.on("error", reject); });
archive.pipe(output);
// Exclude documentation artwork even when dist contains files from an older build.
archive.glob("**/*", { cwd: path.join(root, "dist"), ignore: ["assets/guide/**", "assets/marketing/**"] });
await archive.finalize(); await complete;
console.log(`package.zip: ${archive.pointer()} bytes`);

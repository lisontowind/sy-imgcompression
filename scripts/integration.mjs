// Uses an isolated workspace and home; never connects to a user's running kernel.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const kernelPath = process.env.SIYUAN_KERNEL || "C:/Program Files/SiYuan/resources/kernel/SiYuan-Kernel.exe";
const edgePath = process.env.TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!fs.existsSync(kernelPath) || !fs.existsSync(edgePath)) throw new Error("Set SIYUAN_KERNEL and TEST_BROWSER to installed executables.");
const testRoot = path.join(root, ".cache", "integration-" + Date.now());
const workspace = path.join(testRoot, "workspace"), home = path.join(testRoot, "home");
fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(home, { recursive: true });
const authCode = randomBytes(24).toString("hex");
const log = fs.createWriteStream(path.join(testRoot, "kernel.log"));
const port = await new Promise(resolve => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const origin = "http://127.0.0.1:" + port;
const child = spawn(kernelPath, ["serve", "--workspace", workspace, "--home-dir", home, "--port", String(port), "--accessAuthCode", authCode, "--lang", "en_US"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log); child.stderr.pipe(log);
let token = "", browser, server;
async function api(endpoint, body = {}) {
  const r = await fetch(origin + endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Token " + token }, body: JSON.stringify(body) });
  const data = await r.json(); if (data.code !== 0) throw new Error(endpoint + ": " + data.msg); return data.data;
}
const results = [];
const metrics = {};
let measuringRename = false;
let renameAPITimings = {};
async function readJournal() {
  const response = await fetch(origin + '/api/file/getFile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token }, body: JSON.stringify({ path: '/data/storage/petal/sy-imgcompression/jobs.json' }) });
  assert.equal(response.status, 200); return response.json();
}
async function check(name, fn) {
  if (process.env.SYIC_GUIDE_ONLY === "1" || (process.env.SYIC_BATCH_ONLY === "1" && !name.startsWith("118 images"))) return;
  await fn(); results.push(name); console.log("PASS " + name);
}
try {
  console.log("Starting isolated SiYuan kernel…");
  let ready = false;
  for (let i = 0; i < 45; i++) {
    if (child.exitCode !== null) throw new Error("Kernel exited. See " + testRoot + "/kernel.log");
    try {
      const conf = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8")); token = conf.api?.token || token;
      const progress = await api("/api/system/bootProgress");
      if (progress?.progress === 100) { ready = true; break; }
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Kernel did not become ready. See " + testRoot + "/kernel.log");
  const version = await api("/api/system/version"); console.log("Kernel version: " + version);
  const installedBooks = await api("/api/notebook/lsNotebooks");
  // The initial user guide is test data, not an existing user's notebook.
  for (const book of installedBooks.notebooks || []) {
    if (book.name?.includes("User Guide") || book.name?.includes("用户指南")) await api("/api/notebook/removeNotebook", { notebook: book.id });
  }
  const first = await api("/api/notebook/createNotebook", { name: "Plugin fixture A" });
  const second = await api("/api/notebook/createNotebook", { name: "Plugin fixture closed" });
  const bookA = first.notebook.id, bookB = second.notebook.id;
  const batchBook = (await api("/api/notebook/createNotebook", { name: "Batch closed references" })).notebook.id;

  let messages = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/en_US.json"), "utf8"));
  let activeId = "";
  const fixtureHTML = () => `<!doctype html><meta charset="utf-8"><title>Plugin integration</title><link rel="stylesheet" href="/plugins/sy-imgcompression/index.css"><style>:root{--b3-theme-background:#fff;--b3-theme-on-background:#222;--b3-theme-on-surface:#666;--b3-border-color:#ddd;--b3-theme-surface:#f5f5f5;--b3-theme-primary:#3573f0;--b3-theme-on-primary:white;--b3-theme-error:#d33}body{margin:0;font:14px system-ui}button,input,select{padding:6px;border:1px solid #ccc;border-radius:4px}summary{padding:4px}</style>
  <script>window.module={exports:{}};window.__events={};window.__commands=[];window.__dialogs=[];window.__messages=[];window.siyuan={config:{readonly:false}};
  class HostPlugin{constructor(){this.app={};this.i18n=${JSON.stringify(messages)};this.eventBus={on:(k,f)=>window.__events[k]=f,off:k=>delete window.__events[k]}}addIcons(){}addTopBar(o){window.__open=o.callback}addCommand(o){window.__commands.push(o)}async loadData(k){return JSON.parse(localStorage.getItem(k)||'null')}async saveData(k,v){localStorage.setItem(k,JSON.stringify(v))}}
  class HostDialog{constructor(o){this.element=document.createElement('section');this.element.dataset.title=o.title;this.element.style.cssText='height:'+o.height+';width:min('+o.width+',calc(100vw - 32px));max-height:calc(100vh - 32px);margin:16px auto;overflow:hidden;border-radius:12px;background:var(--b3-theme-background);border:1px solid var(--b3-border-color);';if(window.__dialogs.some(d=>d.element.isConnected))this.element.style.cssText+='position:fixed;left:50%;top:3vh;transform:translateX(-50%);margin:0;z-index:10;box-shadow:0 0 0 100vmax #0005;';this.element.innerHTML=o.content;document.body.append(this.element);this.close=o.destroyCallback;window.__dialogs.push(this)}destroy(){if(!this.element.isConnected)return;this.element.remove();this.close?.()}}
  class HostProtyle{constructor(app,element,o){this.element=element;this.disabled=false;fetch('/api/block/getBlockDOM',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.rootId})}).then(r=>r.json()).then(r=>{if(element.isConnected){element.innerHTML=r.data?.dom||'';o.after?.(this)}})}disable(){this.disabled=true;this.element.dataset.readonly='true'}destroy(){this.element.replaceChildren()}}
  window.require=()=>({Plugin:HostPlugin,Dialog:HostDialog,Protyle:HostProtyle,getFrontend:()=>"desktop",getActiveEditor:()=>({protyle:{block:{rootID:${JSON.stringify(activeId)}},disabled:false}}),showMessage:message=>{window.__messages.push(message);console.log(message)}});
  </script><script src="/plugins/sy-imgcompression/index.js"></script><script>window.__plugin=new module.exports();</script>`;
  server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/")) {
        const started = performance.now();
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const upstream = await fetch(origin + req.url, { method: req.method, headers: { "Content-Type": req.headers["content-type"] || "application/json", Authorization: "Token " + token }, body: Buffer.concat(chunks) });
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream" }); res.end(Buffer.from(await upstream.arrayBuffer()));
        if (measuringRename) {
          const timing = renameAPITimings[req.url] ||= { calls: 0, totalMs: 0, maxMs: 0 };
          const elapsed = Math.round(performance.now() - started); timing.calls++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed);
        }
        return;
      }
      if (req.url === "/" || req.url === "/index.html") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fixtureHTML()); return; }
      if (req.url.startsWith("/assets/")) {
        const upstream = await fetch(origin + req.url, { headers: { Authorization: "Token " + token } });
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream" }); res.end(Buffer.from(await upstream.arrayBuffer())); return;
      }
      const prefix = "/plugins/sy-imgcompression/";
      if (!req.url.startsWith(prefix)) { res.writeHead(404).end(); return; }
      const file = path.resolve(root, "dist", decodeURIComponent(req.url.slice(prefix.length).split("?")[0]));
      if (!file.startsWith(path.join(root, "dist") + path.sep)) { res.writeHead(403).end(); return; }
      const mime = file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
      res.setHeader("Content-Type", mime); fs.createReadStream(file).on("error", () => res.writeHead(404).end()).pipe(res);
    } catch (error) { res.writeHead(500).end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const testOrigin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ executablePath: edgePath, headless: true, args: ["--no-first-run"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = []; page.on("pageerror", error => pageErrors.push(String(error)));
  const referenceRequests = [];
  const apiRequests = [];
  page.on("request", req => { if (req.url().startsWith(testOrigin + "/api/")) apiRequests.push(new URL(req.url()).pathname); });
  page.on("request", req => { if (/\/api\/asset\/(findAssetReferences|relinkAsset)$/.test(req.url())) referenceRequests.push(req.url()); });
  const external = [];
  page.on("request", req => { if (!req.url().startsWith(testOrigin) && !req.url().startsWith("blob:")) external.push(req.url()); });
  await page.goto(testOrigin);
  const source = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 512; c.height = 384;
    const cx = c.getContext("2d"), data = cx.createImageData(c.width, c.height);
    let seed = 17;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const p = (y * c.width + x) * 4;
      data.data[p] = (x + seed % 40) % 256; data.data[p + 1] = (y + seed % 30) % 256; data.data[p + 2] = (x + y) % 256;
      data.data[p + 3] = x < 40 ? Math.round(x / 40 * 255) : 255;
    }
    cx.putImageData(data, 0, 0); return Array.from(new Uint8Array(await (await new Promise(resolve => c.toBlob(resolve, "image/png"))).arrayBuffer()));
  });
  const assetName = "a-20261016000100-abcdefg.png", assetPath = "assets/" + assetName;
  const put = async (filePath, bytes) => {
    const form = new FormData(); form.append("path", filePath); form.append("file", new Blob([bytes]), path.basename(filePath));
    const result = await (await fetch(origin + "/api/file/putFile", { method: "POST", headers: { Authorization: "Token " + token }, body: form })).json();
    assert.equal(result.code, 0, result.msg);
  };
  const pdfPath = "assets/report-20261016000101-pdf0001.pdf";
  await put("/data/" + pdfPath, new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"));
  const annotation = { "20261016000102-mark001": { pages: [{ index: 1, id: "page-1" }], color: "#ffff00", type: "highlight", content: "Fixture annotation", mode: "text" } };
  await put("/data/" + pdfPath + ".sya", new TextEncoder().encode(JSON.stringify(annotation)));
  const form = new FormData(); form.append("path", "/data/" + assetPath); form.append("file", new Blob([new Uint8Array(source)]), assetName);
  const uploaded = await (await fetch(origin + "/api/file/putFile", { method: "POST", headers: { Authorization: "Token " + token }, body: form })).json(); assert.equal(uploaded.code, 0);
  activeId = await api("/api/filetree/createDocWithMd", { notebook: bookA, path: "/项目实施方案验收记录", markdown: `First ![alt](${assetPath} "Title")\n\nSecond ![again](${assetPath})\n\n[attachment](${assetPath}?x=1#frag)\n\n[PDF](${pdfPath}#page=2)` });
  const closedId = await api("/api/filetree/createDocWithMd", { notebook: bookB, path: "/Closed reference", markdown: `![closed](${assetPath})\n\n[PDF closed](${pdfPath})` });
  const avID = "20261016000103-assets1", keyID = "20261016000104-assetk1", valueID = "20261016000105-assetv1";
  await put(`/data/storage/av/${avID}.json`, new TextEncoder().encode(JSON.stringify({ id: avID, name: "Fixture assets", keyValues: [{ key: { id: keyID, name: "Assets", type: "mAsset" }, values: [{ id: valueID, keyID, type: "mAsset", mAsset: [{ type: "image", name: "Fixture", content: assetPath + "#database" }] }] }], views: [] })));
  const emptyAV = "20261016000106-emptyav";
  await api("/api/block/appendBlock", { parentID: activeId, dataType: "dom", data: `<div data-type="NodeAttributeView" data-node-id="20261016000107-emptybl" data-av-id="${emptyAV}" data-av-type="table"></div>` });
  await api("/api/av/renderAttributeView", { id: emptyAV, page: 1, pageSize: 200 });
  await api("/api/attr/setBlockAttrs", { id: activeId, attrs: { "title-img": `background-image: url(\"${assetPath}\");background-position: center;` } });
  await api("/api/notebook/closeNotebook", { notebook: bookB });
  await check("native reference API includes closed notebook, title image and repeated links", async () => {
    const report = await api("/api/asset/findAssetReferences", { path: assetPath });
    assert.equal(report.skippedNotebooks.length, 0); assert(report.references.some(ref => ref.rootID === closedId));
    assert(report.references.some(ref => ref.type === "title-image")); assert(report.references.length >= 5);
    assert(report.references.some(ref => ref.type === "av-asset"));
  });

  await page.reload(); await page.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
  await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
  await check("built plugin opens compression first and scans one shared file", async () => {
    assert.equal(await page.getByRole("tab", { name: "Image compression", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("tbody tr").count(), 1);
    assert((await page.locator(".syic-summary").textContent()).includes("no workspace reference scan"));
    assert.equal(await page.getByLabel("Output format", { exact: true }).inputValue(), "original");
    assert(await page.getByLabel("Output format", { exact: true }).isDisabled());
    assert.equal(referenceRequests.length, 0, "opening the panel must not scan workspace references");
    assert((await page.locator(".syic-total").textContent()).includes("Document attachment total:"));
  });
  await check("custom presets, thumbnail viewing and reference dialogs preserve the main panel", async () => {
    await page.getByLabel("Preset", { exact: true }).selectOption("custom");
    assert.equal(await page.getByLabel("Preset", { exact: true }).inputValue(), "custom");
    await page.getByRole("button", { name: "View image: " + assetName, exact: true }).click();
    await page.locator(".syic-original").evaluate(image => image.decode());
    assert.equal(await page.locator(".syic-preview img").count(), 0);
    await page.evaluate(() => window.__dialogs.at(-1).destroy());
    await page.locator("tbody tr").first().getByRole("button", { name: /^Reference details/ }).click();
    const openReference = page.locator(".syic-ref button").filter({ hasText: "Plugin fixture A" }).first();
    await openReference.click(); await page.locator('.syic-reader[data-readonly="true"] img').first().waitFor();
    assert.equal(referenceRequests.length, 1, "only the explicitly opened attachment should be queried");
    assert((await page.locator(".syic-summary").textContent()).includes("Every reference to the same file"));
    assert.equal(await page.locator(".sy-imgcompression-root tbody tr").count(), 1);
    await page.evaluate(() => window.__dialogs.at(-1).destroy());
  });
  await check("document and image menu hooks expose asynchronously loaded metadata", async () => {
    const before = referenceRequests.length;
    const metadataStart = apiRequests.length;
    const info = await page.evaluate(async ({ id, assetPath }) => {
      const protyle = { block: { rootID: id }, disabled: false }, labels = [];
      const menu = { addItem(item) { const node = document.createElement('div'); node.className='test-menu'; const label = document.createElement('span'); label.className='b3-menu__label'; label.textContent=item.label;node.append(label);document.body.append(node);item.bind?.(node);labels.push({item,node}); } };
      window.__events['click-editortitleicon']({ detail: { menu, protyle } });
      window.__events['open-menu-doctree']({ detail: { menu, type:'doc', items:[{id}] } });
      const image = document.createElement('img');image.src='/'+assetPath;await image.decode();
      window.__events['open-menu-image']({detail:{menu,protyle,element:image}});
      for(let i=0;i<100&&labels.some(x=>x.node.textContent.includes('Loading information'));i++)await new Promise(r=>setTimeout(r,50));
      const result={labels:labels.map(x=>x.node.textContent),breadcrumb:!!window.__events['open-menu-breadcrumbmore']};labels.forEach(x=>x.node.remove());return result;
    }, { id: activeId, assetPath });
    assert.equal(info.breadcrumb, false); assert.equal(info.labels.filter(label => label.includes("Document attachment total:")).length, 2);
    assert(info.labels.some(label => label.includes("512 × 384"))); assert(info.labels.includes("Quick compress"));
    assert.equal(referenceRequests.length, before, "menu metadata must not scan workspace references");
    assert.equal(apiRequests.slice(metadataStart).filter(endpoint => endpoint.endsWith("getBlockInfo")).length, 1, "concurrent menus must share document totals");
  });
  await check("offline WASM compression preview preserves alpha", async () => {
    const before = referenceRequests.length;
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    assert.equal(await page.locator(".syic-preview img").count(), 0);
    await page.getByRole("button", { name: "Generate compression preview", exact: true }).click();
    await page.locator(".syic-preview img").nth(1).waitFor({ timeout: 30000 });
    const images = await page.locator(".syic-preview img").evaluateAll(async elements => {
      const result = [];
      for (const img of elements) {
        await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0); result.push({ width: c.width, height: c.height, alpha: [0, 10, 25, 50].map(x => ctx.getImageData(x, 1, 1, 1).data[3]) });
      }
      return result;
    });
    assert.deepEqual(images[0], images[1]); assert((await page.locator(".syic-status").textContent()).includes("Image file reduction:"));
    await page.screenshot({ path: path.join(testRoot, "compression-preview.png"), fullPage: true });
    await page.evaluate(() => window.__dialogs.at(-1).destroy());
    assert.equal(referenceRequests.length, before, "compression preview must not scan workspace references");
  });
  await check("document scans include database rich-text assets without workspace reference queries", async () => {
    const before = referenceRequests.length;
    const avPath = `/data/storage/av/${emptyAV}.json`;
    const original = fs.readFileSync(path.join(workspace, avPath.slice(1)));
    const hiddenPath = "assets/database-only-20261016000108-rich001.png";
    await put("/data/" + hiddenPath, new Uint8Array(source));
    const database = JSON.parse(original);
    database.keyValues.push({ key: { id: "20261016000109-richkey", name: "Hidden rich text", type: "text" }, values: Array.from({ length: 200 }, (_, i) => (
      { id: `20261016000110-${i.toString(36).padStart(7, "0")}`, keyID: "20261016000109-richkey", type: "text", text: { content: "Hidden link", rich: { spec: 1, format: "kramdown", content: i < 100 ? "ordinary text" : `[Hidden link](${hiddenPath})` } } }
    )) });
    try {
      await put(avPath, new TextEncoder().encode(JSON.stringify(database)));
      const metadataStart = apiRequests.length;
      await page.getByRole("button", { name: "Scan current document", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
      assert.equal(await page.locator(`tbody tr[data-asset-path="${hiddenPath}"]`).count(), 1);
      assert.equal(referenceRequests.length, before);
      assert.equal(apiRequests.slice(metadataStart).filter(endpoint => endpoint.endsWith("md2html")).length, 1, "plain text and repeated rich text must not trigger repeated conversions");
    } finally {
      await put(avPath, original);
      await page.getByRole("button", { name: "Scan current document", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
    }
    assert.equal(await page.locator("tbody tr").count(), 1);
  });
  await check("PNG lossless, downscaling and EXIF-oriented JPEG encoding", async () => {
    const checks = await page.evaluate(async source => {
      const run = (bytes, options) => new Promise((resolve, reject) => {
        const worker = new Worker("/plugins/sy-imgcompression/compression.worker.js");
        worker.onmessage = event => { worker.terminate(); event.data.error ? reject(new Error(event.data.error + ': ' + event.data.detail)) : resolve(event.data.result); };
        worker.onerror = error => { worker.terminate(); reject(new Error(error.message)); }; worker.postMessage({ bytes, options }, [bytes]);
      });
      const pixels = async bytes => {
        const bitmap = await createImageBitmap(new Blob([bytes])); const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext("2d");
        ctx.drawImage(bitmap, 0, 0); bitmap.close(); return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const options = { quality: 82, format: "original", maxWidth: 0, maxHeight: 0 };
      const input = new Uint8Array(source).buffer, lossless = await run(input.slice(0), options);
      const a = await pixels(input), b = await pixels(lossless.bytes);
      const exact = a.length === b.length && a.every((value, index) => value === b[index]);
      const scaled = await run(input.slice(0), { ...options, format: "webp", maxWidth: 128, maxHeight: 128 });
      const c = new OffscreenCanvas(64, 40), ctx = c.getContext("2d"); ctx.fillStyle = "#08f"; ctx.fillRect(0, 0, 64, 40);
      const jpeg = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
      const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
      const oriented = new Uint8Array(jpeg.length + exif.length); oriented.set(jpeg.slice(0,2)); oriented.set(exif,2); oriented.set(jpeg.slice(2),2+exif.length);
      const result = await run(oriented.buffer, options);
      return { exact, pngMime: lossless.mime, scaled: [scaled.width, scaled.height], jpeg: [result.width, result.height], jpegMime: result.mime };
    }, source);
    assert.equal(checks.exact, true); assert.equal(checks.pngMime, "image/png"); assert.deepEqual(checks.scaled, [128, 96]);
    assert.deepEqual(checks.jpeg, [40, 64]); assert.equal(checks.jpegMime, "image/jpeg");
  });
  await check("compression overwrites only image bytes without workspace requests and preserves closed notebooks", async () => {
    const before = referenceRequests.length;
    const started = performance.now(), apiStart = apiRequests.length;
    renameAPITimings = {}; measuringRename = true;
    await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent?.startsWith("Completed"), { timeout: 30000 });
    const job = (await readJournal()).jobs[0];
    assert.equal(job.items[0].state, "completed");
    await page.waitForFunction(() => !document.querySelector(".syic-actions button")?.disabled);
    measuringRename = false;
    metrics.compressSingle = { elapsedMs: Math.round(performance.now() - started), workspaceRequests: referenceRequests.length - before,
      journalWrites: apiRequests.slice(apiStart).filter(endpoint => endpoint.endsWith("putFile")).length - 2, apiTimings: structuredClone(renameAPITimings) };
    console.log("Single-image compression: " + JSON.stringify(metrics.compressSingle));
    renameAPITimings = {};
    assert.equal(referenceRequests.length - before, 0, "image compression must not query or migrate workspace references");
    assert.equal(job.items[0].operation, "replace-file"); assert.equal(job.items[0].newPath, assetPath);
    assert.equal(job.items[0].compressionOptions.format, "original");
    assert.deepEqual(fs.readFileSync(path.join(workspace, job.items[0].backupDiskPath.slice(1))), Buffer.from(source));
    assert(fs.statSync(path.join(workspace, "data", assetPath)).size < source.length);
    assert(fs.statSync(path.join(workspace, "data", assetPath)).mtimeMs > fs.statSync(path.join(workspace, job.items[0].backupDiskPath.slice(1))).mtimeMs);
    const old = await api("/api/asset/findAssetReferences", { path: assetPath }); assert(old.references.some(ref => ref.type === "title-image"));
    const after = await api("/api/asset/findAssetReferences", { path: job.items[0].newPath }); assert(after.references.some(ref => ref.rootID === closedId));
    const database = JSON.parse(fs.readFileSync(path.join(workspace, "data/storage/av", avID + ".json"), "utf8"));
    assert.equal(database.keyValues[0].values[0].mAsset[0].content, job.items[0].newPath + "#database");
    const books = await api("/api/notebook/lsNotebooks"); assert.equal(books.notebooks.find(book => book.id === bookB).closed, true);
    assert(fs.existsSync(path.join(workspace, "data", assetPath)));
  });
  await check("completed image task restores original bytes without workspace requests", async () => {
    const before = referenceRequests.length;
    await page.locator(".syic-history > details").first().locator("summary").first().click();
    await page.getByRole("button", { name: "Restore original image files", exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Restored", { timeout: 30000 });
    assert((await api("/api/asset/findAssetReferences", { path: assetPath })).references.some(ref => ref.rootID === closedId));
    assert.equal(referenceRequests.length - before, 0);
    assert.deepEqual(fs.readFileSync(path.join(workspace, "data", assetPath)), Buffer.from(source));
  });
  await check("custom batch prefixes and individual names retain native IDs and migrate shared references", async () => {
    await page.getByRole("tab", { name: "Image renaming", exact: true }).click();
    await page.getByRole("button", { name: "Scan current document", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
    await page.getByLabel("File type", { exact: true }).selectOption("images");
    assert.equal(await page.locator(".syic-rename-target").textContent(), "image-20261016000100-abcdefg.png");
    await page.getByLabel("Batch filename prefix", { exact: true }).fill("Photos"); await page.getByLabel("Batch filename prefix", { exact: true }).blur();
    assert.equal(await page.locator(".syic-rename-target").textContent(), "Photos-20261016000100-abcdefg.png");
    await page.getByLabel("Individual name: " + assetName, { exact: true }).fill("Cover"); await page.getByLabel("Individual name: " + assetName, { exact: true }).blur();
    const finalName = await page.locator(".syic-rename-target").textContent(); assert.equal(finalName, "Cover-20261016000100-abcdefg.png");
    await page.screenshot({ path: path.join(testRoot, "rename-preview.png"), fullPage: true });
    await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent?.startsWith("Completed"), { timeout: 30000 });
    const job = (await readJournal()).jobs[0]; assert.equal(job.kind, "rename"); assert.equal(job.items[0].state, "completed");
    assert.equal(job.items[0].newPath, "assets/" + finalName);
    assert((await api("/api/asset/findAssetReferences", { path: job.items[0].newPath })).references.some(ref => ref.rootID === closedId));
  });
  await check("non-image attachments are excluded and normalized images need no rename", async () => {
    await page.getByRole("button", { name: "Scan current document", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
    await page.getByLabel("Batch filename prefix", { exact: true }).fill("Cover"); await page.getByLabel("Batch filename prefix", { exact: true }).blur();
    await page.getByLabel("File type", { exact: true }).selectOption("pdf");
    assert(await page.locator("tbody input[type=checkbox]").isDisabled()); assert(await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).isDisabled());
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, "data", pdfPath + ".sya"), "utf8")), annotation);
    await page.getByLabel("File type", { exact: true }).selectOption("images"); assert((await page.locator("tbody").textContent()).includes("No changes needed"));
    await page.locator(".syic-history > details").first().locator("summary").first().click();
    await page.getByRole("button", { name: "Restore matching references", exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Restored", { timeout: 30000 });
  });
  await check("standalone context-menu settings save independently and quick compression opens no dialog", async () => {
    await page.evaluate(({id,assetPath}) => {
      window.__dialogs.find(dialog=>dialog.element.querySelector('.sy-imgcompression-root'))?.destroy();
      const image=document.createElement('img');image.src='/'+assetPath;const items=[];
      window.__events['open-menu-image']({detail:{menu:{addItem:item=>items.push(item)},element:image,protyle:{block:{rootID:id},disabled:false}}});
      items.find(item=>item.label==='Quick compression settings').click();
    },{id:activeId,assetPath});
    assert.equal(await page.locator('.sy-imgcompression-root').count(),0);assert.equal(await page.locator('.syic-settings-box').count(),1);
    await page.locator(".syic-child").getByLabel("Resize mode", { exact: true }).selectOption("50");
    await page.screenshot({path:path.join(testRoot,'quick-settings.png'),fullPage:true});
    await page.locator(".syic-child").getByRole("button", { name: "Save settings", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.syic-child'));
    await page.evaluate(()=>window.__open());await page.waitForFunction(()=>document.querySelector('.syic-status')?.textContent==='Ready',{timeout:30000});
    const count = await page.locator("section").count();
    const referenceStart = referenceRequests.length;
    await page.evaluate(({id,assetPath}) => {
      const image=document.createElement('img');image.src='/'+assetPath; const items=[];
      window.__events['open-menu-image']({detail:{menu:{addItem:item=>items.push(item)},element:image,protyle:{block:{rootID:id},disabled:false}}});
      items.find(item=>item.label==='Quick compress').click();
    }, { id: activeId, assetPath });
    await expect.poll(async () => {
      const { jobs } = await readJournal(); return jobs.length === 3 && jobs[0].state === 'completed';
    }, { timeout: 30000 }).toBe(true);
    assert.equal(await page.locator("section").count(), count);
    const job = (await readJournal()).jobs[0];
    assert.deepEqual(job.items[0].compressionOptions.resize, { mode: 'percent', value: 50 });
    const dimensions = await page.evaluate(async path => { const image=await createImageBitmap(await (await fetch('/'+path)).blob());const size=[image.width,image.height];image.close();return size; }, job.items[0].newPath);
    assert.deepEqual(dimensions, [256,192]);
    await page.waitForFunction(() => document.querySelector('.syic-status')?.textContent==='Ready', {timeout:30000});
    assert.equal(referenceRequests.length - referenceStart, 0, "quick compression must not query workspace references");
    assert.equal(job.items[0].oldPath, job.items[0].newPath);
  });
  await check("per-image overrides affect real outputs while other images inherit global settings", async () => {
    const secondPath = "assets/second-20261016000200-abcdefg.png"; await put('/data/'+secondPath,new Uint8Array(source));
    await api('/api/block/appendBlock',{parentID:activeId,dataType:'markdown',data:`![second](${secondPath})`});
    await page.getByRole('button',{name:'Scan current document',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.syic-status')?.textContent==='Ready',{timeout:30000});
    await page.getByRole('button',{name:'Individual settings',exact:true}).first().click();
    await page.locator('.syic-child').getByLabel('Resize mode',{exact:true}).selectOption('50');
    await page.locator('.syic-child').getByRole('button',{name:'Save settings',exact:true}).click();
    await page.locator('.syic-global-profile').getByLabel('Preset',{exact:true}).selectOption('70');
    assert((await page.locator('.syic-item-config').first().textContent()).includes('50%'));
    await page.getByRole('button',{name:'Apply to selected attachments',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.syic-status')?.textContent?.startsWith('Completed'),{timeout:30000});
    const job=(await readJournal()).jobs[0];assert.equal(job.items.length,2);
    const sizes=await page.evaluate(async items=>Promise.all(items.map(async item=>{const bitmap=await createImageBitmap(await(await fetch('/'+item.newPath)).blob());const size=[bitmap.width,bitmap.height];bitmap.close();return size;})),job.items);
    assert.deepEqual(sizes,[[128,96],[512,384]]);assert.equal(job.items[0].compressionOptions.quality,82);assert.equal(job.items[1].compressionOptions.quality,70);
  });
  await check("Chinese interface, dark theme and persisted history survive reopening", async () => {
    messages = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/zh_CN.json"), "utf8"));
    await page.reload(); await page.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "就绪", { timeout: 30000 });
    assert.equal(await page.getByRole("tab", { name: "图片压缩", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(".syic-history > details").count(), 4);
    assert.equal(await page.getByLabel("质量", { exact: true }).inputValue(), "70");
    await page.evaluate(() => {
      const colors = { "--b3-theme-background": "#1e2025", "--b3-theme-on-background": "#e8e9ee", "--b3-theme-on-surface": "#b4b8c4", "--b3-border-color": "#40444e", "--b3-theme-surface": "#292d35" };
      for (const [name, value] of Object.entries(colors)) document.documentElement.style.setProperty(name, value);
      document.body.style.background = "#1e2025";
    });
    await page.locator('.syic-thumbnail').evaluateAll(images=>Promise.allSettled(images.map(image=>image.decode())));
    await page.locator('.sy-imgcompression-root').evaluate(root=>{root.scrollTop=0;});
    await page.screenshot({ path: path.join(testRoot, "compression-zh-dark.png"), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.setViewportSize({width:680,height:900});
    await page.locator('.sy-imgcompression-root').evaluate(root=>{root.scrollTop=0;});
    await page.screenshot({path:path.join(testRoot,'compression-zh-narrow.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.setViewportSize({width:1280,height:1000});
    await page.getByRole("tab", { name: "图片重命名", exact: true }).click();
    assert.equal(await page.locator(".syic-rename-target").count(), 2);
    await page.locator('.sy-imgcompression-root').evaluate(root=>{root.scrollTop=0;});
    await page.screenshot({ path: path.join(testRoot, "rename-zh-dark.png"), fullPage: true });
  });
  await check("empty documents show zero bytes instead of read errors", async () => {
    activeId = await api('/api/filetree/createDocWithMd',{notebook:bookA,path:'/Empty fixture',markdown:''});
    await page.reload(); await page.evaluate(async()=>{await window.__plugin.onload();window.__open();});
    await page.waitForFunction(()=>document.querySelector('.syic-status')?.textContent==='当前文档没有本地附件。',{timeout:30000});
    assert((await page.locator('.syic-total').textContent()).includes('0 B'));assert(await page.getByRole('button',{name:'应用到选中附件',exact:true}).isDisabled());
  });
  await check("two windows retain each other's durable jobs and restore using the latest journal", async () => {
    messages = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/en_US.json"), "utf8"));
    const originalIds = (await readJournal()).jobs.map(job => job.id), windows = [], documentIds = [];
    const windowContext = await browser.newContext();
    try {
      // Initialize both windows before either writes a task, leaving the second
      // window with an intentionally stale in-memory journal.
      for (const name of ["Window A", "Window B"]) {
        const imagePath = `assets/${name.replace(' ', '-')}-20261016000300-abcdefg.png`;
        await put('/data/' + imagePath, new Uint8Array(source));
        activeId = await api('/api/filetree/createDocWithMd', { notebook: bookA, path: '/' + name, markdown: `![fixture](${imagePath})` });
        documentIds.push(activeId);
        const window = await windowContext.newPage(); windows.push(window);
        window.on('pageerror', error => pageErrors.push(String(error)));
        window.on('request', req => { if (!req.url().startsWith(testOrigin) && !req.url().startsWith('blob:')) external.push(req.url()); });
        await window.goto(testOrigin);
        await window.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
        await window.waitForFunction(() => document.querySelector('.syic-status')?.textContent === 'Ready');
      }
      for (const window of windows) {
        await window.getByRole('button', { name: 'Apply to selected attachments', exact: true }).click();
        await window.waitForFunction(() => document.querySelector('.syic-status')?.textContent?.startsWith('Completed'));
      }
      const latest = await readJournal();
      assert.equal(latest.jobs.length, originalIds.length + 2);
      assert.deepEqual(latest.jobs.slice(0, 2).map(job => job.documentId), [...documentIds].reverse());
      assert.deepEqual(latest.jobs.slice(2).map(job => job.id), originalIds);
      await windows[0].locator('.syic-history > details').first().locator('summary').click();
      await windows[0].getByRole('button', { name: 'Restore original image files', exact: true }).first().click();
      await windows[0].waitForFunction(() => document.querySelector('.syic-status')?.textContent === 'Restored');
      const restored = await readJournal();
      assert.equal(restored.jobs[0].state, 'completed'); assert.equal(restored.jobs[1].state, 'restored');
      assert.equal(restored.jobs.length, latest.jobs.length);
    } finally { await windowContext.close(); }
  });
  await check("118 images rename through four workspace requests, including closed-notebook shared references", async () => {
    await page.bringToFront();
    messages = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/en_US.json"), "utf8"));
    const bytes = new Uint8Array(await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 12;
      canvas.getContext("2d").fillRect(0, 0, 16, 12);
      return Array.from(new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, "image/png"))).arrayBuffer()));
    }));
    const paths = Array.from({ length: 118 }, (_, i) => `assets/batch-${i}-20261113000100-${i.toString(36).padStart(7, "0")}.png`);
    for (const asset of paths) await put("/data/" + asset, bytes);
    const markdown = paths.map(asset => `![batch](${asset})`).join("\n\n");
    activeId = await api("/api/filetree/createDocWithMd", { notebook: bookA, path: "/118 image batch", markdown });
    const closedBook = batchBook;
    const sharedId = await api("/api/filetree/createDocWithMd", { notebook: closedBook, path: "/Shared batch", markdown });
    await api("/api/notebook/closeNotebook", { notebook: closedBook });
    const scanStarted = performance.now(), scanRequestStart = apiRequests.length;
    await page.reload(); await page.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
    const scanRequests = apiRequests.slice(scanRequestStart);
    assert(!scanRequests.some(endpoint => /readDir|findAssetReferences|relinkAsset/.test(endpoint)));
    metrics.scan118 = { elapsedMs: Math.round(performance.now() - scanStarted), images: 118, directoryRequests: 0, workspaceReferenceRequests: 0, statRequests: scanRequests.filter(endpoint => endpoint.endsWith("statAsset")).length, pathRequests: scanRequests.filter(endpoint => endpoint.endsWith("resolveAssetPath")).length };
    assert.equal(metrics.scan118.statRequests, 118); assert.equal(metrics.scan118.pathRequests, 118);
    console.log("118-image scan: " + JSON.stringify(metrics.scan118));
    await page.getByRole("tab", { name: "Image renaming", exact: true }).click();
    assert.equal(await page.locator("tbody tr").count(), 118);
    const requestStart = referenceRequests.length, started = performance.now(); measuringRename = true;
    await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Completed", undefined, { timeout: 120000 });
    await page.getByRole("button", { name: "Scan current document", exact: true }).waitFor({ state: "visible" });
    await expect(page.getByRole("button", { name: "Scan current document", exact: true })).toBeEnabled({ timeout: 30000 });
    const elapsedMs = Math.round(performance.now() - started), requests = referenceRequests.length - requestStart; measuringRename = false;
    const job = (await readJournal()).jobs[0];
    assert.equal(job.items.length, 118); assert.equal(job.state, "completed");
    assert(job.items.every(item => item.state === "completed" && item.after.some(ref => ref.rootID === sharedId)));
    assert.equal(requests, 4);
    const verified = await api("/api/asset/findAssetReferences", { paths: job.items.flatMap(item => [item.oldPath, item.newPath]) });
    assert.equal(verified.items.length, 236); assert(verified.items.every(item => item.ok));
    for (const item of job.items) {
      assert.equal(verified.items.find(result => result.oldPath === item.oldPath).references.length, 0);
      assert.equal(verified.items.find(result => result.oldPath === item.newPath).references.length, 2);
      for (const asset of [item.oldPath, item.newPath]) assert.deepEqual(fs.readFileSync(path.join(workspace, "data", asset)), Buffer.from(bytes));
    }
    assert((await api("/api/notebook/lsNotebooks")).notebooks.find(book => book.id === closedBook).closed);
    metrics.rename118 = { elapsedMs, workspaceRequests: requests, images: 118, bytesPerImage: bytes.length, sharedReferences: 236, apiTimings: renameAPITimings };
    console.log("118-image rename: " + JSON.stringify(metrics.rename118));
    const restoreStart = referenceRequests.length, restoreStarted = performance.now(); renameAPITimings = {}; measuringRename = true;
    const history = page.locator(".syic-history > details").first(); await history.locator("summary").click();
    await history.getByRole("button", { name: "Restore matching references", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Restored", undefined, { timeout: 120000 });
    await expect(page.getByRole("button", { name: "Scan current document", exact: true })).toBeEnabled({ timeout: 30000 });
    measuringRename = false;
    assert.equal(referenceRequests.length - restoreStart, 4);
    const restored = (await readJournal()).jobs[0]; assert.equal(restored.state, "restored"); assert(restored.items.every(item => item.state === "restored"));
    metrics.restore118 = { elapsedMs: Math.round(performance.now() - restoreStarted), workspaceRequests: 4, images: 118, apiTimings: renameAPITimings };
    console.log("118-image restore: " + JSON.stringify(metrics.restore118));
  });
  await check("118 images compress and restore in place without workspace reference requests", async () => {
    await page.getByRole("tab", { name: "Image compression", exact: true }).click();
    await page.getByLabel("Preset", { exact: true }).selectOption("82");
    assert.equal(await page.getByLabel("Output format", { exact: true }).inputValue(), "original");
    await page.getByLabel("Resize mode", { exact: true }).selectOption("original");
    assert.equal(await page.locator("tbody tr").count(), 118);
    const start = referenceRequests.length, started = performance.now(); renameAPITimings = {}; measuringRename = true;
    await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent?.startsWith("Completed"), undefined, { timeout: 180000 });
    await expect(page.getByRole("button", { name: "Scan current document", exact: true })).toBeEnabled({ timeout: 30000 }); measuringRename = false;
    const job = (await readJournal()).jobs[0]; assert.equal(job.kind, "compress"); assert.equal(job.items.length, 118);
    assert(job.items.every(item => item.state === "completed" && item.resultSize < item.originalSize && item.operation === "replace-file" && item.oldPath === item.newPath));
    assert.equal(referenceRequests.length - start, 0);
    for (const item of job.items) {
      assert.deepEqual(fs.readFileSync(path.join(workspace, item.backupDiskPath.slice(1))), fs.readFileSync(path.join(workspace, job.items[0].backupDiskPath.slice(1))));
    }
    metrics.compress118 = { elapsedMs: Math.round(performance.now() - started), workspaceRequests: 0, journalWrites: renameAPITimings["/api/file/putFile"].calls - 236, images: 118, sourceBytes: job.items.reduce((sum, item) => sum + item.originalSize, 0), outputBytes: job.items.reduce((sum, item) => sum + item.resultSize, 0), apiTimings: renameAPITimings };
    console.log("118-image compression: " + JSON.stringify(metrics.compress118));
    const restoreStart = referenceRequests.length;
    const history = page.locator(".syic-history > details").first(); await history.locator("summary").click();
    await history.getByRole("button", { name: "Restore original image files", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Restored", undefined, { timeout: 120000 });
    await expect(page.getByRole("button", { name: "Scan current document", exact: true })).toBeEnabled({ timeout: 30000 });
    assert.equal(referenceRequests.length - restoreStart, 0);
    for (const item of job.items) assert.deepEqual(fs.readFileSync(path.join(workspace, item.oldDiskPath.slice(1))), fs.readFileSync(path.join(workspace, item.backupDiskPath.slice(1))));
    assert.equal((await readJournal()).jobs[0].state, "restored");
  });
  await check("native document scans resolve encoded notebook-local assets and retain rename recovery", async () => {
    const name = "本地 %-20261113000500-local01.png", asset = "assets/" + name;
    // Existing attachments may contain characters rejected by current uploads.
    // Seed this legacy filename only inside the isolated fixture workspace.
    const localFile = path.join(workspace, "data", bookA, asset);
    fs.mkdirSync(path.dirname(localFile), { recursive: true }); fs.writeFileSync(localFile, Buffer.from(source));
    activeId = await api("/api/filetree/createDocWithMd", { notebook: bookA, path: "/Local encoded attachment", markdown: `![local](${asset.split("/").map(encodeURIComponent).join("/")})` });
    const requestStart = apiRequests.length;
    await page.reload(); await page.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready");
    assert.equal(await page.locator("tbody tr").count(), 1);
    assert.equal(await page.locator("tbody input[type=checkbox]").isEnabled(), true);
    assert(!apiRequests.slice(requestStart).some(endpoint => /readDir|findAssetReferences|relinkAsset/.test(endpoint)));
    await page.getByRole("tab", { name: "Image renaming", exact: true }).click();
    await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Completed");
    await expect(page.getByRole("button", { name: "Scan current document", exact: true })).toBeEnabled();
    const job = (await readJournal()).jobs[0];
    assert.equal(job.items[0].state, "completed");
    assert(job.items[0].oldDiskPath.replaceAll("\\", "/").endsWith(`/data/${bookA}/${asset}`));
    assert.deepEqual(fs.readFileSync(path.join(workspace, "data", bookA, asset)), Buffer.from(source));
    await page.locator(".syic-history > details").first().locator("summary").first().click();
    await page.getByRole("button", { name: "Restore matching references", exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Restored");
    assert.equal((await readJournal()).jobs[0].state, "restored");
    assert((await api("/api/asset/findAssetReferences", { path: asset.split("/").map(encodeURIComponent).join("/") })).references.some(ref => ref.rootID === activeId));
  });
  await check("fast browsing still blocks ambiguous attachments before copying or migrating references", async () => {
    const asset = "assets/duplicate-20261113000600-dupe001.png";
    await put("/data/" + asset, new Uint8Array(source));
    await put(`/data/${bookA}/${asset}`, new Uint8Array(source));
    activeId = await api("/api/filetree/createDocWithMd", { notebook: bookA, path: "/Ambiguous attachment", markdown: `![duplicate](${asset})` });
    const requestStart = apiRequests.length;
    await page.reload(); await page.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready");
    assert(!apiRequests.slice(requestStart).some(endpoint => /readDir|findAssetReferences|relinkAsset/.test(endpoint)));
    await page.getByRole("tab", { name: "Image renaming", exact: true }).click();
    const target = "assets/" + await page.locator(".syic-rename-target").textContent();
    const mutationStart = referenceRequests.length;
    await page.getByRole("button", { name: "Apply to selected attachments", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.classList.contains("syic-error"));
    assert((await page.locator(".syic-status").textContent()).includes("ambiguous"));
    assert(!fs.existsSync(path.join(workspace, "data", target)));
    assert(!referenceRequests.slice(mutationStart).some(url => url.endsWith("relinkAsset")));
    assert.deepEqual(fs.readFileSync(path.join(workspace, "data", asset)), Buffer.from(source));
    assert.deepEqual(fs.readFileSync(path.join(workspace, "data", bookA, asset)), Buffer.from(source));
  });
  await check("history deletion removes only plugin backups and accepts missing backups without workspace scans", async () => {
    messages = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/en_US.json"), "utf8"));
    await page.reload(); await page.evaluate(async () => { await window.__plugin.onload(); window.__open(); });
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Ready", { timeout: 30000 });
    const journal = await readJournal();
    const selected = journal.jobs.find(job => job.items.length === 1 && job.items[0].operation === "replace-file" && job.items[0].backupDiskPath);
    assert(selected);
    const currentFiles = new Map();
    for (const job of journal.jobs) for (const item of job.items) for (const file of [item.oldDiskPath, item.newDiskPath]) {
      if (!file?.startsWith("/data/")) continue;
      const local = path.resolve(workspace, file.slice(1));
      assert(local.startsWith(path.resolve(workspace, "data") + path.sep));
      if (fs.existsSync(local)) currentFiles.set(local, fs.readFileSync(local));
    }
    const before = referenceRequests.length;
    const history = page.locator(`.syic-history > details[data-job-id="${selected.id}"]`);
    await history.locator("summary").click();
    await history.getByRole("button", { name: "Delete task and backups", exact: true }).click();
    let confirmation = page.locator(".syic-delete-history");
    assert((await confirmation.textContent()).includes("can no longer be restored"));
    await page.screenshot({ path: path.join(testRoot, "history-delete-confirmation.png"), fullPage: true });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await readJournal()).jobs.length, journal.jobs.length);
    assert(fs.existsSync(path.join(workspace, selected.items[0].backupDiskPath.slice(1))));
    await history.getByRole("button", { name: "Delete task and backups", exact: true }).click();
    await page.locator(".syic-delete-history").getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".syic-status")?.textContent === "Task history and corresponding plugin backups were deleted.");
    const remaining = (await readJournal()).jobs;
    assert.equal(remaining.length, journal.jobs.length - 1); assert(!remaining.some(job => job.id === selected.id));
    assert(!fs.existsSync(path.join(workspace, selected.items[0].backupDiskPath.slice(1))));
    // Simulate a backup already removed by the user; its record must still clear.
    const missing = remaining.flatMap(job => job.items).find(item => item.backupDiskPath && fs.existsSync(path.join(workspace, item.backupDiskPath.slice(1))));
    assert(missing); await api("/api/file/removeFile", { path: missing.backupDiskPath });
    await page.getByRole("button", { name: "Clear all history and backups", exact: true }).click();
    confirmation = page.locator(".syic-delete-history");
    assert((await confirmation.textContent()).includes(`Delete ${remaining.length} task records`));
    await confirmation.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect.poll(async () => (await readJournal()).jobs.length, { timeout: 30000 }).toBe(0);
    await expect(page.getByRole("button", { name: "Clear all history and backups", exact: true })).toBeDisabled();
    assert.equal(await page.locator(".syic-history > details").count(), 0);
    assert.equal(fs.readdirSync(path.join(workspace, "data/storage/petal/sy-imgcompression/backups")).length, 0);
    assert.equal(referenceRequests.length - before, 0);
    for (const [file, bytes] of currentFiles) assert.deepEqual(fs.readFileSync(file), bytes);
    await page.screenshot({ path: path.join(testRoot, "history-cleared.png"), fullPage: true });
  });
  if (process.env.SYIC_GENERATE_GUIDE === "1") {
    const languages = (process.env.SYIC_GUIDE_LANGUAGE || "zh_CN,en_US").split(",");
    assert(languages.every(language => ["zh_CN", "en_US"].includes(language)), "Unsupported guide language");
    const { createGuide } = await import("./guide-images.mjs");
    for (const language of languages) {
      messages = JSON.parse(fs.readFileSync(path.join(root, "src/i18n", language + ".json"), "utf8"));
      await createGuide({ page, api, put, root, bookA, pdfPath, language, messages, setActive: id => { activeId = id; } });
    }
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(external, []);
  fs.writeFileSync(path.join(testRoot, "result.json"), JSON.stringify({ version, results, metrics, pageErrors, external, workspace }, null, 2));
  fs.writeFileSync(path.join(root, ".cache", process.env.SYIC_GUIDE_ONLY === "1" ? "last-guide.json" : "last-integration.json"), JSON.stringify({ testRoot, version, results, metrics }, null, 2));
  console.log(process.env.SYIC_GUIDE_ONLY === "1" ? `Guide capture complete. Evidence: ${testRoot}` : `All ${results.length} integration checks passed. Evidence: ${testRoot}`);
} catch (error) {
  if (measuringRename) console.error("Rename API timings: " + JSON.stringify(renameAPITimings));
  console.error(error); if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    try { console.error((await page.locator(".syic-status").textContent()) || ""); await page.screenshot({ path: path.join(testRoot, "failure.png"), fullPage: true }); } catch {}
  }
  console.error("Evidence: " + testRoot); process.exitCode = 1;
} finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  child.kill(); log.end();
}

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { AttachmentPanel } from "../src/ui/panel";
import { scanDocument } from "../src/core/assets";
import { JobManager } from "../src/core/jobs";
import { loadSettings } from "../src/core/settings";
import { translator } from "../src/i18n";
import { AssetJob, DocumentAssets, Kernel, UserError } from "../src/types";
import { png, ref, report } from "./fixtures";
import { Dialog, Protyle } from "./siyuan-host";
import { quickSettingsDialog } from "../src/ui/quick-settings";

vi.mock("../src/core/assets", () => ({ scanDocument: vi.fn() }));
const doc: DocumentAssets = { id: "20261016000000-abcdefg", title: "Fixture", notebooks: [], stats: { bytes: 345, count: 3, unknown: 0 }, assets: ["a", "b"].map((name, i) => ({
  path: `assets/${name}.png`, diskPath: `/data/assets/${name}.png`, name: `${name}.png`, extension: ".png", size: 45, references: [ref()], blockers: [], selected: true, order: i,
})) };
let panel: AttachmentPanel;
beforeEach(() => { document.body.replaceChildren(); Dialog.instances = []; Protyle.instances = []; vi.mocked(scanDocument).mockResolvedValue(structuredClone(doc));
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: {
    digest: (algorithm: string, bytes: ArrayBuffer) => webcrypto.subtle.digest(algorithm, Buffer.from(new Uint8Array(bytes))),
  } });
  URL.createObjectURL = vi.fn(() => "blob:test"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { panel?.dispose(); vi.unstubAllGlobals(); });
async function setup() {
  const root = document.createElement("div"); document.body.append(root);
  const compressor = { compress: vi.fn(async () => ({ bytes: new ArrayBuffer(20), mime: "image/webp", extension: ".webp", width: 16, height: 12, originalWidth: 16, originalHeight: 12 })), cancel: vi.fn() };
  const kernel = { readFile: vi.fn(async () => png()), putFile: vi.fn(), post: vi.fn(async () => ({})) } as unknown as Kernel;
  const manager = new JobManager(kernel, { load: async () => undefined, save: async () => {} }, compressor), settings = loadSettings(undefined);
  const save = vi.fn(async (key: "quick" | "global", profile) => { settings[key] = profile; });
  panel = new AttachmentPanel(root, kernel, manager, translator({}), doc.id, "compress", undefined, { settings, save, app: {} as never });
  await panel.start(); return { root, manager, compressor, save, settings, kernel };
}
async function click(label: string, root: ParentNode = document) {
  const node = [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label || button.getAttribute("aria-label") === label)!;
  expect(node, label).toBeTruthy(); node.click(); await Promise.resolve(); await Promise.resolve();
}
function change(root: ParentNode, label: string, value: string) {
  const node = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  node.value = value; node.dispatchEvent(new Event("change", { bubbles: true }));
}
it("does not request thumbnails for attachments that are not available locally", async () => {
  const deferred = structuredClone(doc);
  Object.assign(deferred.assets[0], { diskPath: "", blockers: ["missingLocalAsset"], selected: false });
  vi.mocked(scanDocument).mockResolvedValueOnce(deferred);
  const { root } = await setup(), rows = root.querySelectorAll("tbody tr");
  expect(rows[0].querySelector("img")).toBeNull(); expect(rows[0].querySelector("input")!.disabled).toBe(true);
  expect(rows[1].querySelector("img")).not.toBeNull();
});
it("opens originals and preview panels without compressing until requested", async () => {
  const { root, compressor } = await setup(); const list = root.querySelector<HTMLElement>(".syic-list")!; list.scrollTop = 60;
  await click("View image: a.png"); expect(compressor.compress).not.toHaveBeenCalled(); expect(root.querySelector(".syic-original")).toBeNull();
  await click("Preview", root); expect(compressor.compress).not.toHaveBeenCalled();
  await click("Generate compression preview"); await vi.waitFor(() => expect(document.querySelectorAll(".syic-preview img"), document.querySelector(".syic-preview-state")?.textContent || "").toHaveLength(2));
  expect(compressor.compress).toHaveBeenCalledTimes(1);
  Dialog.instances.at(-1)!.destroy(); expect(list.scrollTop).toBe(60); expect(root.querySelector<HTMLInputElement>('tbody input')!.checked).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it("keeps individual configuration through global changes and mode switches", async () => {
  const { root } = await setup(); await click("Individual settings", root);
  const child = document.querySelector(".syic-child")!; change(child, "Quality", "55"); await click("Save settings", child);
  change(root, "Quality", "70"); expect(root.querySelectorAll(".syic-item-config")[0].textContent).toContain("Quality 55");
  expect(root.querySelectorAll(".syic-item-config")[1].textContent).toContain("Quality 70");
  await click("Image renaming", root); await click("Image compression", root); expect(root.querySelectorAll(".syic-item-config")[0].textContent).toContain("Quality 55");
  await click("Restore inheritance", root); expect(root.querySelectorAll(".syic-item-config")[0].textContent).toContain("Quality 70");
});
it("marks previews stale after changing parameters without automatically encoding", async () => {
  const { root, compressor } = await setup(); await click("Preview", root); await click("Generate compression preview");
  await vi.waitFor(() => expect(document.querySelectorAll(".syic-preview img")).toHaveLength(2));
  change(document.querySelector(".syic-child")!, "Quality", "60");
  expect(document.querySelectorAll(".syic-preview img")).toHaveLength(0); expect(document.querySelector(".syic-preview-state")!.textContent).toContain("Settings changed"); expect(compressor.compress).toHaveBeenCalledTimes(1);
});
it("saves quick settings independently and does not change document totals under filtering", async () => {
  const { root, settings } = await setup(); await click("Quick compression settings", root);
  const child = document.querySelector(".syic-child")!; change(child, "Quality", "50"); await click("Save settings", child);
  expect(settings.quick.options.quality).toBe(50); expect(settings.global.options.quality).toBe(82);
  change(root, "Minimum original filename bytes", "999"); expect(root.querySelector(".syic-total")!.textContent).toContain("345 B");
  expect(root.querySelector(".syic-list")!.textContent).toContain("No matching");
});
it("embeds reference reading as read-only and disposes the reader", async () => {
  const { root } = await setup(); await click("Reference details (1)", root);
  const child = document.querySelector(".syic-child")!; child.querySelector<HTMLButtonElement>(".syic-ref button")!.click();
  await vi.waitFor(() => expect(Protyle.instances).toHaveLength(1)); expect(Protyle.instances[0].disabled).toBe(true);
  Dialog.instances.at(-1)!.destroy(); expect(Protyle.instances[0].destroyed).toBe(true);
});
it("loads reference details on demand and reuses them only within the current scan", async () => {
  const deferred = structuredClone(doc); deferred.assets.forEach(asset => { asset.references = []; asset.referencesLoaded = false; });
  vi.mocked(scanDocument).mockResolvedValue(deferred);
  const { root, kernel } = await setup();
  expect(kernel.post).not.toHaveBeenCalled();
  expect(root.querySelector(".syic-impact")!.textContent).toContain("when you open reference details");
  vi.mocked(kernel.post).mockResolvedValue(report([ref()]));
  await click("Reference details", root);
  await vi.waitFor(() => expect(document.querySelectorAll(".syic-ref")).toHaveLength(1));
  const queries = () => vi.mocked(kernel.post).mock.calls.filter(([endpoint]) => endpoint.endsWith("findAssetReferences"));
  expect(queries()).toHaveLength(1);
  expect(queries()[0]).toEqual(["/api/asset/findAssetReferences", { path: "assets/a.png" }, expect.objectContaining({ aborted: false })]);
  Dialog.instances.at(-1)!.destroy(); await click("Reference details (1)", root);
  expect(queries()).toHaveLength(1);
  Dialog.instances.at(-1)!.destroy();
  const fresh = structuredClone(doc); fresh.assets.forEach(asset => { asset.references = []; asset.referencesLoaded = false; });
  vi.mocked(scanDocument).mockResolvedValueOnce(fresh); await click("Scan current document", root);
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".syic-actions button")!.disabled).toBe(false));
  await click("Reference details", root);
  await vi.waitFor(() => expect(queries()).toHaveLength(2));
});
it("aborts an on-demand reference query when its dialog closes and allows retry", async () => {
  const deferred = structuredClone(doc); deferred.assets[0].referencesLoaded = false; deferred.assets[0].references = [];
  vi.mocked(scanDocument).mockResolvedValue(deferred);
  const { root, kernel } = await setup(); let signal: AbortSignal | undefined;
  vi.mocked(kernel.post).mockImplementationOnce(async (_endpoint, _body, activeSignal) => {
    signal = activeSignal;
    return new Promise((_resolve, reject) => activeSignal!.addEventListener("abort", () => reject(new UserError("cancelled")), { once: true }));
  });
  await click("Reference details", root); expect(signal?.aborted).toBe(false);
  Dialog.instances.at(-1)!.destroy();
  await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>(".syic-actions button")!.disabled).toBe(false));
  expect(signal?.aborted).toBe(true); expect(deferred.assets[0].referencesLoaded).toBe(false);
  vi.mocked(kernel.post).mockResolvedValue(report([ref()])); await click("Reference details", root);
  await vi.waitFor(() => expect(document.querySelectorAll(".syic-ref")).toHaveLength(1));
});
it("does not invalidate a running preview when the original finishes loading", async () => {
  const { root, compressor } = await setup();
  let finish!: (result: Awaited<ReturnType<typeof compressor.compress>>) => void;
  compressor.compress.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click("Preview", root); await click("Generate compression preview");
  await vi.waitFor(() => expect(compressor.compress).toHaveBeenCalledOnce());
  document.querySelector(".syic-original")!.dispatchEvent(new Event("load"));
  finish({ bytes: new ArrayBuffer(20), mime: "image/webp", extension: ".webp", width: 16, height: 12, originalWidth: 16, originalHeight: 12 });
  await vi.waitFor(() => expect(document.querySelectorAll(".syic-preview img")).toHaveLength(2));
});
it("cancels a closed preview and discards late results", async () => {
  const { root, manager, compressor } = await setup();
  let finish!: (result: Awaited<ReturnType<typeof compressor.compress>>) => void;
  compressor.compress.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click("Preview", root); await click("Generate compression preview");
  await vi.waitFor(() => expect(compressor.compress).toHaveBeenCalledOnce()); Dialog.instances.at(-1)!.destroy();
  expect(compressor.cancel).toHaveBeenCalledOnce();
  finish({ bytes: new ArrayBuffer(20), mime: "image/webp", extension: ".webp", width: 16, height: 12, originalWidth: 16, originalHeight: 12 });
  await vi.waitFor(() => expect(manager.busy).toBe(false)); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(document.querySelector(".syic-child")).toBeNull();
});
it("keeps closed notebook references visible without constructing a reader", async () => {
  const closed = structuredClone(doc); closed.notebooks = [{ id: "notebook", name: "Closed notebook", closed: true }];
  vi.mocked(scanDocument).mockResolvedValue(closed);
  const { root } = await setup(); await click("Reference details (1)", root);
  const child = document.querySelector(".syic-child")!; expect(child.textContent).toContain("Closed notebook (closed)");
  child.querySelector<HTMLButtonElement>(".syic-ref button")!.click(); await Promise.resolve(); await Promise.resolve();
  expect(Protyle.instances).toHaveLength(0); expect(child.textContent).toContain("closed or unavailable");
});
it("previews batch prefixes and per-image names, preserving overrides across global edits", async () => {
  const { root } = await setup(); await click("Image renaming", root);
  change(root, "Batch filename prefix", "旅行");
  const initial = root.querySelectorAll(".syic-rename-target")[0].textContent!;
  change(root, "Individual name: a.png", "封面"); change(root, "Batch filename prefix", "照片");
  expect(root.querySelectorAll(".syic-rename-target")[0].textContent).toBe(initial.replace("旅行-", "封面-"));
  expect(root.querySelectorAll(".syic-rename-target")[1].textContent).toMatch(/^照片-/);
  await click("Image compression", root); await click("Image renaming", root);
  expect(root.querySelector<HTMLInputElement>('[aria-label="Individual name: a.png"]')!.value).toBe("封面");
  await click("Use batch prefix", root); expect(root.querySelectorAll(".syic-rename-target")[0].textContent).toMatch(/^照片-/);
});
it("keeps rows and thumbnails while batch prefixes and individual names are edited", async () => {
  const { root } = await setup(); await click("Image renaming", root);
  const rows = [...root.querySelectorAll("tbody tr")], images = rows.map(row => row.querySelector("img"));
  change(root, "Batch filename prefix", "Photos"); change(root, "Individual name: a.png", "Cover");
  expect([...root.querySelectorAll("tbody tr")]).toEqual(rows);
  expect(rows.map(row => row.querySelector("img"))).toEqual(images);
});
it("updates no-change selection and status without rebuilding renamed rows", async () => {
  const normalized = structuredClone(doc);
  Object.assign(normalized.assets[0], { path: "assets/Cover-20261016000100-abcdefg.png", name: "Cover-20261016000100-abcdefg.png" });
  vi.mocked(scanDocument).mockResolvedValueOnce(normalized);
  const { root } = await setup(); await click("Image renaming", root);
  const row = root.querySelector("tbody tr")!;
  change(root, "Batch filename prefix", "Cover");
  expect(root.querySelector("tbody tr")).toBe(row); expect(row.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  expect(row.querySelector(".syic-item-status")!.textContent).toContain("No changes");
  change(root, "Batch filename prefix", "Photos"); expect(row.querySelector<HTMLInputElement>("input")!.disabled).toBe(false);
});
it("blocks invalid visible names and re-enables apply after correction", async () => {
  const { root } = await setup(); await click("Image renaming", root);
  const apply = [...root.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "Apply to selected attachments")!;
  change(root, "Individual name: a.png", "../invalid"); expect(apply.disabled).toBe(true);
  expect(root.querySelector<HTMLInputElement>('[aria-label="Individual name: a.png"]')!.checkValidity()).toBe(false);
  change(root, "Individual name: a.png", "fixed"); expect(apply.disabled).toBe(false);
  expect(root.querySelector(".syic-rename-target")!.textContent).toMatch(/^fixed-/);
});
it("opens quick configuration independently of the document panel and cancels without saving", async () => {
  const settings = loadSettings(undefined), save = vi.fn(async () => {});
  const standalone = quickSettingsDialog(settings.quick, translator({}), save);
  expect(document.querySelector(".syic-settings-box legend")!.textContent).toContain("Image context menu");
  expect(document.querySelector(".syic-table")).toBeNull(); change(standalone.root, "Quality", "55");
  await click("Close", standalone.root); expect(standalone.closed).toBe(true); expect(save).not.toHaveBeenCalled(); expect(settings.quick.options.quality).toBe(82);
});
it("keeps standalone quick settings open and displays failed saves", async () => {
  const standalone = quickSettingsDialog(loadSettings(undefined).quick, translator({}), async () => { throw new Error("disk full"); });
  await click("Save settings", standalone.root); await vi.waitFor(() => expect(standalone.root.querySelector(".syic-error")).not.toBeNull());
  expect(standalone.closed).toBe(false); standalone.destroy();
});
it("preserves image rows and thumbnails when selection and compression settings change", async () => {
  const { root } = await setup();
  const row = root.querySelector("tbody tr")!, thumbnail = row.querySelector("img")!;
  const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  checkbox.click();
  expect(root.querySelector("tbody tr")).toBe(row); expect(row.querySelector("img")).toBe(thumbnail);
  expect(root.querySelector<HTMLInputElement>("thead input")!.indeterminate).toBe(true);
  expect(root.querySelector(".syic-selected")!.textContent).toContain("1");
  change(root, "Quality", "70");
  expect(root.querySelector("tbody tr")).toBe(row); expect(row.querySelector("img")).toBe(thumbnail);
  expect(row.querySelector(".syic-item-config")!.textContent).toContain("Quality 70");
  root.querySelector<HTMLInputElement>("thead input")!.click();
  expect(checkbox.checked).toBe(true); expect(root.querySelector("tbody tr")).toBe(row);
});
it("renders job item details only when history is expanded and preserves expansion on updates", async () => {
  const { root, manager } = await setup();
  const job: AssetJob = { schema: 1, id: "history-job", kind: "compress", documentId: doc.id, documentTitle: "History", created: new Date().toISOString(), state: "completed", options: loadSettings(undefined).global.options,
    items: Array.from({ length: 500 }, (_, i) => ({ oldPath: `assets/${i}.png`, newPath: `assets/${i}.webp`, oldDiskPath: "", newDiskPath: "", originalSize: 45, state: "completed", before: [], plannedAfter: [] })),
  };
  manager.journal.jobs = [job]; manager.onChange?.();
  expect(root.querySelectorAll(".syic-job-item")).toHaveLength(0);
  const details = root.querySelector<HTMLDetailsElement>(".syic-history details")!;
  details.open = true; details.dispatchEvent(new Event("toggle"));
  expect(root.querySelectorAll(".syic-job-item")).toHaveLength(500);
  const firstItem = root.querySelector(".syic-job-item");
  manager.onChange?.();
  expect(root.querySelector<HTMLDetailsElement>(".syic-history details")!.open).toBe(true);
  expect(root.querySelectorAll(".syic-job-item")).toHaveLength(500);
  expect(root.querySelector(".syic-job-item")).toBe(firstItem);
});
it("cancels an in-flight scan when the panel closes", async () => {
  await setup(); let signal: AbortSignal | undefined;
  vi.mocked(scanDocument).mockImplementationOnce(async (_kernel, _id, _path, _progress, activeSignal) => {
    signal = activeSignal;
    return new Promise((_resolve, reject) => activeSignal!.addEventListener("abort", () => reject(new UserError("cancelled")), { once: true }));
  });
  await click("Scan current document");
  expect(signal?.aborted).toBe(false); panel.dispose();
  expect(signal?.aborted).toBe(true);
});

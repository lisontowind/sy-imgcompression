// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { AttachmentPanel } from "../src/ui/panel";
import { scanDocument } from "../src/core/assets";
import { JobManager } from "../src/core/jobs";
import { loadSettings } from "../src/core/settings";
import { translator } from "../src/i18n";
import { DocumentAssets, Kernel } from "../src/types";
import { png, ref } from "./fixtures";
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
  await panel.start(); return { root, manager, compressor, save, settings };
}
async function click(label: string, root: ParentNode = document) {
  const node = [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label || button.getAttribute("aria-label") === label)!;
  expect(node, label).toBeTruthy(); node.click(); await Promise.resolve(); await Promise.resolve();
}
function change(root: ParentNode, label: string, value: string) {
  const node = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  node.value = value; node.dispatchEvent(new Event("change", { bubbles: true }));
}
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

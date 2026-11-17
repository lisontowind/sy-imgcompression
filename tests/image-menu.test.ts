// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("siyuan", () => ({
  Plugin: class {
    i18n = {}; app = {}; handlers = new Map<string, (event: any) => void>();
    eventBus = { on: (key: string, fn: (event: any) => void) => this.handlers.set(key, fn), off: (key: string) => this.handlers.delete(key) };
    addIcons() {} addTopBar() {} addCommand() {} async loadData() { return undefined; }
  }, Dialog: class {}, getFrontend: () => "desktop", getActiveEditor: () => undefined, showMessage: () => {},
}));
import ImageCompressionPlugin from "../src/index";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it.each([
  ["/assets/%E5%9B%BE%20%25.JpEg?x=1#frag", "JPEG"], ["assets/a.PNG", "PNG"], ["assets/a.webp", "WebP"], ["assets/a.gif", "GIF"], ["assets/noextension", "Unknown format"],
])("shows extension-derived %s metadata without extra image reads", async (path, format) => {
  const fetcher = vi.fn(async (_url: string) => new Response("", { status: 404 })); vi.stubGlobal("fetch", fetcher);
  const plugin = new ImageCompressionPlugin({} as never); await plugin.onload(); fetcher.mockClear();
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: { size: 200 } }), { status: 200 }));
  const image = document.createElement("img"); image.setAttribute("data-src", path);
  Object.defineProperties(image, { naturalWidth: { value: 512 }, naturalHeight: { value: 384 } });
  const node = document.createElement("div"); node.innerHTML = '<span class="b3-menu__label"></span>'; document.body.append(node);
  const items: any[] = [], menu = { addItem: (item: any) => { items.push(item); if (item.bind) item.bind(node); } };
  (plugin as any).handlers.get("open-menu-image")({ detail: { menu, element: image, protyle: { block: { rootID: "doc" } } } });
  await vi.waitFor(() => expect(node.textContent).toBe(`${format} · 512 × 384 · 200 B`));
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toBe("/api/asset/statAsset");
  expect(items.find(item => item.label === "Quick compression settings")).toBeDefined(); plugin.onunload();
});
it("keeps format and dimensions when size lookup fails", async () => {
  const fetcher = vi.fn(async () => new Response("", { status: 404 })); vi.stubGlobal("fetch", fetcher);
  const plugin = new ImageCompressionPlugin({} as never); await plugin.onload();
  const image = document.createElement("img"); image.src = "/assets/a.png";
  Object.defineProperties(image, { naturalWidth: { value: 16 }, naturalHeight: { value: 12 } });
  const node = document.createElement("div"); document.body.append(node);
  (plugin as any).handlers.get("open-menu-image")({ detail: { menu: { addItem: (item: any) => item.bind?.(node) }, element: image, protyle: { disabled: true } } });
  await vi.waitFor(() => expect(node.textContent).toBe("PNG · 16 × 12 · Unknown size")); plugin.onunload();
});

import { afterEach, expect, it, vi } from "vitest";
import { SiYuanKernel, fileExists, readJSON } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

it("shares pending metadata reads but never shares reference or mutation requests", async () => {
  const fetcher = vi.fn(async () => new Response('{"code":0,"data":{"size":45}}'));
  vi.stubGlobal("fetch", fetcher); const kernel = new SiYuanKernel();
  await Promise.all([kernel.post("/api/asset/statAsset", { path: "assets/a.png" }), kernel.post("/api/asset/statAsset", { path: "assets/a.png" })]);
  expect(fetcher).toHaveBeenCalledOnce();
  await kernel.post("/api/asset/statAsset", { path: "assets/a.png" }); expect(fetcher).toHaveBeenCalledTimes(2);
  await Promise.all([kernel.post("/api/asset/findAssetReferences", { path: "assets/a.png" }), kernel.post("/api/asset/findAssetReferences", { path: "assets/a.png" })]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  await Promise.all([kernel.post("/api/asset/relinkAsset", {}), kernel.post("/api/asset/relinkAsset", {})]);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("checks the target directly without enumerating or downloading the attachment directory", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }));
  const fetcher = vi.fn().mockResolvedValueOnce(response)
    .mockResolvedValueOnce(new Response('{"code":404,"msg":"missing"}', { status: 202 }))
    .mockResolvedValueOnce(new Response('{"code":409,"msg":"directory"}', { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  const kernel = new SiYuanKernel();
  expect(await fileExists(kernel, "/data/assets/existing.png")).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  expect(await fileExists(kernel, "/data/assets/new.png")).toBe(false);
  expect(await fileExists(kernel, "/data/assets/directory.png")).toBe(true);
  expect(fetcher.mock.calls.every(([endpoint]) => endpoint === "/api/file/getFile")).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).path).toBe("/data/assets/new.png");
});

it("does not mistake an unreadable target or failed existence request for an available filename", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"code":403,"msg":"forbidden"}', { status: 202 }))
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockRejectedValueOnce(new Error("network unavailable"));
  vi.stubGlobal("fetch", fetcher);
  const kernel = new SiYuanKernel();
  await expect(fileExists(kernel, "target")).rejects.toThrow("readFailed");
  await expect(fileExists(kernel, "target")).rejects.toThrow("readFailed");
  await expect(fileExists(kernel, "target")).rejects.toThrow("network unavailable");
});

it("treats only the kernel's explicit missing-file response as an absent journal", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"code":404,"msg":"missing"}', { status: 202 }))
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const kernel = new SiYuanKernel();
  expect(await kernel.readOptionalJSON("/data/storage/petal/sy-imgcompression/jobs.json")).toBeUndefined();
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow("readFailed");
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow();
});
it("does not mistake a binary-API journal read error for empty history", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response('{"code":403,"msg":"unreadable"}', { status: 202 }))
    .mockResolvedValueOnce(new Response("", { status: 202 })));
  const kernel = new SiYuanKernel();
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow("readFailed");
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow("readFailed");
});

it("does not return a cached journal after a later read fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response('{"jobs":[]}'))
    .mockRejectedValueOnce(new Error("network unavailable")));
  const kernel = new SiYuanKernel();
  expect(await kernel.readOptionalJSON("journal")).toEqual({ jobs: [] });
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow("network unavailable");
});

it("requires a successful kernel acknowledgement when persisting a journal", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":-1,"msg":"disk full"}')));
  await expect(new SiYuanKernel().putFile("journal", new ArrayBuffer(0))).rejects.toThrow("disk full");
});
it("retains explicit kernel error codes for idempotent backup cleanup", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"code":404,"msg":"path does not exist"}')));
  await expect(new SiYuanKernel().post("/api/file/removeFile", { path: "backup" })).rejects.toMatchObject({ code: 404, outcomeUnknown: false });
});

it("forwards cancellation to read-only fetches and preserves cancellation errors", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    expect(options.signal).toBe(controller.signal);
    controller.abort(); throw new DOMException("Aborted", "AbortError");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(new SiYuanKernel().post("/api/file/readDir", { path: "/data" }, controller.signal)).rejects.toThrow("cancelled");
  await expect(readJSON(new SiYuanKernel(), "document", controller.signal)).rejects.toThrow("cancelled");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

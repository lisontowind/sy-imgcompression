import { afterEach, expect, it, vi } from "vitest";
import { SiYuanKernel, readJSON } from "../src/api";

afterEach(() => vi.unstubAllGlobals());

it("treats only the kernel's explicit missing-file response as an absent journal", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 202 }))
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const kernel = new SiYuanKernel();
  expect(await kernel.readOptionalJSON("/data/storage/petal/sy-imgcompression/jobs.json")).toBeUndefined();
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow("readFailed");
  await expect(kernel.readOptionalJSON("journal")).rejects.toThrow();
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

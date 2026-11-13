import { expect, it, vi } from "vitest";
import { ReadPool } from "../src/core/read-pool";

it("coalesces pending reads without caching completed or failed results", async () => {
  const pool = new ReadPool(); let finish!: (value: number) => void;
  const execute = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  const first = pool.run("same", execute), second = pool.run("same", execute);
  expect(execute).toHaveBeenCalledOnce(); finish(7);
  expect(await Promise.all([first, second])).toEqual([7, 7]);
  const third = pool.run("same", execute); expect(execute).toHaveBeenCalledTimes(2); finish(8); expect(await third).toBe(8);
  await expect(pool.run("failed", async () => { throw new Error("unavailable"); })).rejects.toThrow("unavailable");
  expect(await pool.run("failed", async () => 9)).toBe(9);
});
it("cancels one subscriber without cancelling another subscriber's request", async () => {
  const pool = new ReadPool(), controller = new AbortController();
  let finish!: (value: number) => void, shared!: AbortSignal;
  const execute = vi.fn((signal: AbortSignal) => { shared = signal; return new Promise<number>(resolve => { finish = resolve; }); });
  const first = pool.run("same", execute, controller.signal), second = pool.run("same", execute);
  const cancelled = expect(first).rejects.toThrow("cancelled"); controller.abort(); await cancelled;
  expect(shared.aborted).toBe(false); finish(4); expect(await second).toBe(4);
});
it("limits all reads and drops a cancelled queued request before it starts", async () => {
  const pool = new ReadPool(2), controller = new AbortController();
  const finishes: (() => void)[] = []; let active = 0, maximum = 0;
  const execute = vi.fn(() => new Promise<void>(resolve => { maximum = Math.max(maximum, ++active); finishes.push(() => { active--; resolve(); }); }));
  const first = pool.run("1", execute), second = pool.run("2", execute), queued = pool.run("3", execute, controller.signal), fourth = pool.run("4", execute);
  const cancelled = expect(queued).rejects.toThrow("cancelled"); controller.abort(); await cancelled;
  expect(execute).toHaveBeenCalledTimes(2); finishes.shift()!(); await first;
  expect(execute).toHaveBeenCalledTimes(3); finishes.shift()!(); finishes.shift()!(); await Promise.all([second, fourth]);
  expect(maximum).toBe(2);
});
it("aborts orphaned network reads and lets a later subscriber start a fresh request", async () => {
  const pool = new ReadPool(), controller = new AbortController();
  const execute = vi.fn((signal: AbortSignal) => new Promise<number>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
  const pending = pool.run("key", execute, controller.signal), cancelled = expect(pending).rejects.toThrow("cancelled");
  controller.abort(); await cancelled;
  expect(await pool.run("key", async () => 3)).toBe(3);
});
it("cancels queued and active reads together on disposal", async () => {
  const pool = new ReadPool(1);
  const execute = vi.fn((signal: AbortSignal) => new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
  const results = Promise.allSettled([pool.run("one", execute), pool.run("two", execute)]);
  pool.cancel();
  expect((await results).every(result => result.status === "rejected")).toBe(true);
  expect(execute).toHaveBeenCalledOnce(); expect(await pool.run("fresh", async () => 1)).toBe(1);
});

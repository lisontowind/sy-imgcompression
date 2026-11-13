import { UserError } from "../types";

interface Reader {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
}
interface ReadTask {
  key: string; controller: AbortController; readers: Set<Reader>;
  execute(signal: AbortSignal): Promise<unknown>;
}

/** Share only pending reads, with separate cancellation and a global limit. */
export class ReadPool {
  private pending = new Map<string, ReadTask>();
  private queue: ReadTask[] = [];
  private active = 0;
  constructor(private limit = 6) {}
  run<T>(key: string, execute: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new UserError("cancelled"));
    let task = this.pending.get(key);
    if (!task) {
      task = { key, controller: new AbortController(), readers: new Set(), execute };
      this.pending.set(key, task); this.queue.push(task);
    }
    const current = task;
    const result = new Promise<T>((resolve, reject) => {
      const abort = () => {
        reader.cleanup(); current.readers.delete(reader); reject(new UserError("cancelled"));
        if (!current.readers.size) {
          if (this.pending.get(key) === current) this.pending.delete(key);
          current.controller.abort();
        }
      };
      const reader: Reader = { resolve: value => resolve(value as T), reject, cleanup: () => signal?.removeEventListener("abort", abort) };
      current.readers.add(reader); signal?.addEventListener("abort", abort, { once: true });
    });
    this.drain(); return result;
  }
  cancel(): void {
    for (const task of this.pending.values()) {
      task.controller.abort();
      for (const reader of task.readers) { reader.cleanup(); reader.reject(new UserError("cancelled")); }
      task.readers.clear();
    }
    this.pending.clear(); this.queue = [];
  }
  private drain(): void {
    while (this.active < this.limit && this.queue.length) {
      const task = this.queue.shift()!;
      if (!task.readers.size) continue;
      this.active++;
      void (async () => {
        try {
          const value = await task.execute(task.controller.signal);
          for (const reader of task.readers) { reader.cleanup(); reader.resolve(value); }
        } catch (error) {
          for (const reader of task.readers) { reader.cleanup(); reader.reject(error); }
        } finally {
          task.readers.clear();
          if (this.pending.get(task.key) === task) this.pending.delete(task.key);
          this.active--; this.drain();
        }
      })();
    }
  }
}

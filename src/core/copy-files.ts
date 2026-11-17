import { applyBatch, BatchContext } from "./batch-operations";
import { AssetIdentity, AssetJob, JobItem, Kernel, ReferenceReport } from "../types";
import { assertComplete } from "./references";

/** Adapt only a rejected read-only batch lookup. Never retry a mutation. */
function singleRequests(kernel: Kernel): Kernel {
  return {
    readFile: (path, signal) => kernel.readFile(path, signal),
    putFile: (path, bytes) => kernel.putFile(path, bytes),
    ...(kernel.fileExists ? { fileExists: (path: string) => kernel.fileExists!(path) } : {}),
    async post<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> {
      const request = body as { paths?: string[]; mappings?: { oldPath: string; newPath: string }[]; dryRun?: boolean };
      if (!request.paths && !request.mappings) return kernel.post(endpoint, body, signal);
      const items: NonNullable<ReferenceReport["items"]> = [];
      let historyPath = "";
      for (const mapping of request.mappings || request.paths!.map(oldPath => ({ oldPath, newPath: "" }))) {
        const report = await kernel.post<ReferenceReport>(endpoint, request.paths ? { path: mapping.oldPath }
          : { ...mapping, dryRun: request.dryRun }, signal);
        assertComplete(report); historyPath = report.historyPath || historyPath;
        items.push({ ...mapping, ok: true, reason: "", references: report.references, updated: report.updated });
      }
      return { references: items.flatMap(item => item.references), items, skippedNotebooks: [],
        dryRun: !!request.dryRun, historyPath, updated: items.reduce((sum, item) => sum + item.updated, 0) } as T;
    },
  };
}

export async function copyFiles(kernel: Kernel, job: AssetJob, assets: Map<string, AssetIdentity>, items: JobItem[], context: BatchContext, outputs: Map<string, ArrayBuffer>): Promise<void> {
  if (!await applyBatch(kernel, job, assets, items, context, outputs)) {
    await applyBatch(singleRequests(kernel), job, assets, items, context, outputs);
  }
}

import { UserError } from "../types";

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UserError("cancelled");
}

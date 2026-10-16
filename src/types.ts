export type JobKind = "compress" | "rename";
export type OutputFormat = "webp" | "original";
export type ResizeMode = "original" | "percent" | "width" | "height" | "longestEdge";
export interface CompressionOptions {
  quality: number; format: OutputFormat; maxWidth: number; maxHeight: number;
  resize?: { mode: ResizeMode; value: number };
}
export interface CompressionProfile { preset: "90" | "82" | "70" | "custom"; options: CompressionOptions }
export interface PluginSettings { schema: 1; global: CompressionProfile; quick: CompressionProfile }
// Persisted key retained for existing task journals; ASCII costs 1.5 budget units.
export interface RenameOptions { documentNameMaxBytes: number; prefix?: string }
export interface Notebook { id: string; name: string; closed: boolean }
export interface AssetReference {
  oldPath?: string; type: string; notebook: string; rootID: string; path: string;
  blockID: string; avID: string; valueID: string; reference: string;
  replacement: string; relinkable: boolean; reason: string;
}
export interface ReferenceReport {
  references: AssetReference[]; skippedNotebooks: string[]; dryRun: boolean;
  historyPath: string; updated: number;
  unavailableAttributeViews?: { avID: string; notebook: string; reason: string }[];
  items?: { oldPath: string; newPath: string; ok: boolean; reason: string; references: AssetReference[]; updated: number }[];
}
export interface AssetIdentity {
  path: string; diskPath: string; name: string; extension: string; size: number;
  references: AssetReference[]; blockers: string[]; selected: boolean; order: number;
  newPath?: string; previewDigest?: string; sizeKnown?: boolean; renameStem?: string;
}
export interface AttachmentStats { bytes: number; unknown: number; count: number }
export interface DocumentAssets { id: string; title: string; notebooks: Notebook[]; assets: AssetIdentity[]; stats?: AttachmentStats }
export interface CompressionResult { bytes: ArrayBuffer; mime: string; extension: string; width: number; height: number; originalWidth: number; originalHeight: number }
export type ItemState = "pending" | "prepared" | "applying" | "completed" | "skipped" | "failed" | "recovery-required" | "restored";
export interface JobItem {
  oldPath: string; newPath: string; oldDiskPath: string; newDiskPath: string;
  state: ItemState; before: AssetReference[]; plannedAfter: AssetReference[]; after?: AssetReference[];
  error?: string; originalSize: number; resultSize?: number; sourceDigest?: string; targetDigest?: string;
  historyPath?: string; compressionOptions?: CompressionOptions;
}
export interface AssetJob {
  schema: 1; id: string; kind: JobKind; documentId: string; documentTitle: string;
  created: string; finished?: string; state: "running" | "completed" | "interrupted" | "restored";
  options: CompressionOptions | RenameOptions; items: JobItem[];
}
export interface Journal { jobs: AssetJob[] }
export interface Progress { done: number; total: number; path: string; stage: string }
export interface DirectoryEntry { name: string; isDir: boolean; isSymlink?: boolean; updated: number }
export interface Kernel {
  post<T>(endpoint: string, body: unknown): Promise<T>;
  readFile(path: string): Promise<ArrayBuffer>;
  putFile(path: string, bytes: ArrayBuffer): Promise<void>;
}
export class UserError extends Error {
  constructor(public code: string, public detail = "") { super(detail ? `${code}: ${detail}` : code); this.name = "UserError"; }
}

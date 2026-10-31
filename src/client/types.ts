import type { RequestHeader } from "../types";

export type JobStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "canceled";

export type FileKind =
  | "video"
  | "audio"
  | "image"
  | "archive"
  | "document"
  | "other";

export type Filter = "all" | "active" | "completed" | "paused" | "failed";

export interface Job {
  id: string;
  url: string;
  finalUrl: string | null;
  fileName: string;
  filePath: string;
  contentType: string;
  kind: FileKind;
  totalBytes: number;
  downloadedBytes: number;
  etag: string | null;
  lastModified: string | null;
  supportsRanges: boolean;
  status: JobStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  attempts: number;
  speedBps: number;
  etaSeconds: number | null;
  progress: number | null;
  host: string;
  canPreview: boolean;
  fileExists: boolean;
  isPartial: boolean;
  rangeStart: number;
  rangeEnd: number | null;
  rangeIf: string | null;
  remoteTotal: number;
  httpStatus: number | null;
  headers: RequestHeader[];
}

export interface AppSettings {
  downloadDir: string;
  maxConcurrent: number;
  speedLimitBps: number;
}

export interface Summary {
  total: number;
  active: number;
  downloading: number;
  queued: number;
  completed: number;
  paused: number;
  failed: number;
  canceled: number;
  speedBps: number;
  bytesOnDisk: number;
  completedBytes: number;
  downloadDir: string;
}

export interface Snapshot {
  jobs: Job[];
  summary: Summary;
  settings: AppSettings;
}

export interface Probe {
  url: string;
  finalUrl: string;
  fileName: string;
  contentType: string;
  kind: FileKind;
  totalBytes: number;
  supportsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  status: number;
}

export interface InspectResult {
  probe: Probe;
  canPreview: boolean;
  previewUrl: string | null;
}

export interface PartialRangeRequest {
  start: number;
  end: number | null;
  ifRange: string | null;
}

export interface ApiErrorBody {
  error?: string;
  errors?: Array<{ url: string; error: string }>;
}

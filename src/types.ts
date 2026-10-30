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

export interface DownloadRow {
  id: string;
  url: string;
  final_url: string | null;
  file_name: string;
  file_path: string;
  content_type: string;
  total_bytes: number;
  downloaded_bytes: number;
  etag: string | null;
  last_modified: string | null;
  supports_ranges: number;
  status: JobStatus;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  attempts: number;
  speed_bps: number;
}

export interface PublicJob {
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
}

export interface AppSettings {
  downloadDir: string;
  maxConcurrent: number;
  speedLimitBps: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: "",
  maxConcurrent: 3,
  speedLimitBps: 0,
};

export interface ProbeResult {
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

export interface AddDownloadInput {
  url: string;
  finalUrl: string;
  fileName: string;
  contentType: string;
  totalBytes: number;
  supportsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
}

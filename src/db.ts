import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AppSettings, DownloadRow, JobStatus } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  final_url TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  total_bytes INTEGER NOT NULL DEFAULT 0,
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  last_modified TEXT,
  supports_ranges INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  speed_bps INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const PATCHABLE = new Set<keyof DownloadRow>([
  "url",
  "final_url",
  "file_name",
  "file_path",
  "content_type",
  "total_bytes",
  "downloaded_bytes",
  "etag",
  "last_modified",
  "supports_ranges",
  "status",
  "error",
  "updated_at",
  "started_at",
  "completed_at",
  "attempts",
  "speed_bps",
]);

export interface NewDownload {
  id: string;
  url: string;
  finalUrl: string;
  fileName: string;
  filePath: string;
  contentType: string;
  totalBytes: number;
  supportsRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  now: number;
}

export class Store {
  readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  listDownloads(): DownloadRow[] {
    return this.db
      .query("SELECT * FROM downloads ORDER BY created_at DESC")
      .all() as DownloadRow[];
  }

  getDownload(id: string): DownloadRow | null {
    return (
      (this.db
        .query("SELECT * FROM downloads WHERE id = ?")
        .get(id) as DownloadRow | null) ?? null
    );
  }

  nextQueued(): DownloadRow | null {
    return (
      (this.db
        .query(
          "SELECT * FROM downloads WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
        )
        .get() as DownloadRow | null) ?? null
    );
  }

  insertDownload(input: NewDownload): DownloadRow {
    this.db
      .query(
        `INSERT INTO downloads (
          id, url, final_url, file_name, file_path, content_type,
          total_bytes, downloaded_bytes, supports_ranges, etag, last_modified, status,
          created_at, updated_at, attempts, speed_bps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'queued', ?, ?, 0, 0)`,
      )
      .run(
        input.id,
        input.url,
        input.finalUrl,
        input.fileName,
        input.filePath,
        input.contentType,
        input.totalBytes,
        input.supportsRanges ? 1 : 0,
        input.etag,
        input.lastModified,
        input.now,
        input.now,
      );
    const row = this.getDownload(input.id);
    if (!row) throw new Error("Failed to create download record.");
    return row;
  }

  patch(id: string, fields: Partial<DownloadRow>): DownloadRow | null {
    const entries = Object.entries(fields).filter(
      ([key, value]) =>
        PATCHABLE.has(key as keyof DownloadRow) && value !== undefined,
    );
    if (entries.length === 0) return this.getDownload(id);

    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value as string | number | null);
    this.db
      .query(`UPDATE downloads SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, Date.now(), id);
    return this.getDownload(id);
  }

  setStatus(
    id: string,
    status: JobStatus,
    fields: Partial<DownloadRow> = {},
  ): DownloadRow | null {
    return this.patch(id, {
      ...fields,
      status,
      speed_bps: status === "downloading" ? fields.speed_bps : 0,
    });
  }

  setAllStatus(from: JobStatus, to: JobStatus): number {
    const result = this.db
      .query(
        "UPDATE downloads SET status = ?, speed_bps = 0, updated_at = ? WHERE status = ?",
      )
      .run(to, Date.now(), from);
    return result.changes;
  }

  deleteDownload(id: string): boolean {
    return (
      this.db.query("DELETE FROM downloads WHERE id = ?").run(id).changes > 0
    );
  }

  clearTerminal(statuses: JobStatus[]): number {
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map(() => "?").join(", ");
    return this.db
      .query(`DELETE FROM downloads WHERE status IN (${placeholders})`)
      .run(...statuses).changes;
  }

  resetInterrupted(): number {
    return this.db
      .query(
        "UPDATE downloads SET status = 'queued', speed_bps = 0, error = NULL, updated_at = ? WHERE status = 'downloading'",
      )
      .run(Date.now()).changes;
  }

  getSettings(defaults: AppSettings): AppSettings {
    const row = this.db
      .query("SELECT value FROM settings WHERE key = 'app'")
      .get() as { value: string } | null;
    if (!row) return defaults;
    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>;
      return {
        downloadDir:
          typeof parsed.downloadDir === "string" && parsed.downloadDir
            ? parsed.downloadDir
            : defaults.downloadDir,
        maxConcurrent:
          Number.isFinite(parsed.maxConcurrent) && Number(parsed.maxConcurrent) > 0
            ? Math.min(10, Math.round(Number(parsed.maxConcurrent)))
            : defaults.maxConcurrent,
        speedLimitBps:
          Number.isFinite(parsed.speedLimitBps) &&
          Number(parsed.speedLimitBps) >= 0
            ? Math.max(0, Math.round(Number(parsed.speedLimitBps)))
            : defaults.speedLimitBps,
      };
    } catch {
      return defaults;
    }
  }

  saveSettings(settings: AppSettings): void {
    this.db
      .query(
        "INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(settings));
  }
}

export function partPathFor(filePath: string): string {
  return `${filePath}.part`;
}

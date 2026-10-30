import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import {
  mkdir,
  open,
  rename,
  rm,
  stat,
  truncate,
} from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";
import { Store, partPathFor } from "./db";
import {
  buildRequestHeaders,
  parseStoredHeaders,
  storedHeadersJson,
} from "./headers";
import type {
  AppSettings,
  DownloadRow,
  JobStatus,
  PartialRangeOptions,
  PublicJob,
  RequestHeader,
} from "./types";
import {
  headerNumber,
  isPartialRange,
  parseContentRange,
  partialFileName,
  sanitizeFileName,
  sleepWithSignal,
  toPublicJob,
} from "./utils";

export type EngineEvent =
  | { type: "job"; job: PublicJob }
  | { type: "deleted"; id: string }
  | { type: "settings"; settings: AppSettings }
  | { type: "refresh" };

interface Runtime {
  controller: AbortController;
  done: Promise<void>;
  resolveDone: () => void;
  job: DownloadRow;
  meter: SpeedMeter;
  lastPersist: number;
  lastEmit: number;
}

class SpeedMeter {
  private samples: Array<{ time: number; bytes: number }> = [];
  private bytes: number;

  constructor(startBytes = 0) {
    this.bytes = startBytes;
    this.samples.push({ time: Date.now(), bytes: startBytes });
  }

  add(bytes: number): void {
    this.bytes += bytes;
    this.push();
  }

  set(bytes: number): void {
    this.bytes = bytes;
    this.push();
  }

  private push(): void {
    const now = Date.now();
    this.samples.push({ time: now, bytes: this.bytes });
    this.prune(now);
  }

  private prune(now: number): void {
    const cutoff = now - 4_000;
    while (this.samples.length > 2 && (this.samples[0]?.time ?? now) < cutoff) {
      this.samples.shift();
    }
  }

  rate(now = Date.now()): number {
    this.prune(now);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || this.samples.length < 2) return 0;
    const elapsed = (last.time - first.time) / 1000;
    if (elapsed <= 0) return 0;
    return Math.max(0, Math.round((last.bytes - first.bytes) / elapsed));
  }
}

class RateLimiter {
  private limit = 0;
  private tokens = 0;
  private capacity = 0;
  private last = Date.now();

  constructor(limit: number) {
    this.setLimit(limit);
  }

  setLimit(limit: number): void {
    const next = Math.max(0, Math.round(limit));
    if (next === this.limit) return;
    this.limit = next;
    this.capacity =
      next > 0
        ? Math.max(64 * 1024, Math.min(next, 1024 * 1024))
        : 0;
    // Start with an empty bucket so the limit applies immediately instead of
    // allowing a large speed-limit-sized burst on every download.
    this.tokens = 0;
    this.last = Date.now();
  }

  private refill(): void {
    if (this.limit <= 0) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsed * this.limit) / 1000,
    );
  }

  async take(bytes: number, signal: AbortSignal): Promise<void> {
    if (this.limit <= 0 || bytes <= 0) return;
    let remaining = bytes;
    while (remaining > 0) {
      const slice = Math.min(remaining, this.capacity);
      this.refill();
      while (this.tokens < slice) {
        const missing = slice - this.tokens;
        const wait = Math.max(4, Math.ceil((missing / this.limit) * 1000));
        await sleepWithSignal(Math.min(wait, 750), signal);
        this.refill();
      }
      this.tokens -= slice;
      remaining -= slice;
    }
  }
}

class DownloadFailure extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "DownloadFailure";
    this.status = status;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof DownloadFailure) return error.message;
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Download paused.";
    if (error.message.includes("fetch failed")) {
      return "The connection to the remote server was lost.";
    }
    return error.message.slice(0, 600);
  }
  return "An unexpected error stopped the download.";
}

function httpFailure(response: Response): DownloadFailure {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new DownloadFailure(
      `Access denied by the remote server (HTTP ${status}). The link may have expired or need a referer/cookie.`,
      status,
    );
  }
  if (status === 404) {
    return new DownloadFailure("The remote file no longer exists (HTTP 404).", status);
  }
  if (status === 429) {
    return new DownloadFailure(
      "The remote server is rate limiting downloads (HTTP 429). Try again later.",
      status,
    );
  }
  return new DownloadFailure(
    `Remote server returned HTTP ${status}${response.statusText ? ` ${response.statusText}` : ""}.`,
    status,
  );
}

function parseUnsatisfiedTotal(value: string | null): number | null {
  if (!value) return null;
  const match = /^bytes\s+\*\/(\d+)$/i.exec(value.trim());
  return match?.[1] ? Number(match[1]) : null;
}

export class DownloadEngine {
  private readonly store: Store;
  private settings: AppSettings;
  private readonly active = new Map<string, Runtime>();
  private readonly reserved = new Set<string>();
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly limiter: RateLimiter;
  private stopping = false;
  private pumpScheduled = false;

  constructor(store: Store, settings: AppSettings) {
    this.store = store;
    this.settings = settings;
    this.limiter = new RateLimiter(settings.speedLimitBps);
    for (const job of store.listDownloads()) this.reserved.add(job.file_path);
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* an SSE client must not break the engine */
      }
    }
  }

  private emitJob(row: DownloadRow, meter?: SpeedMeter): void {
    const speed = meter?.rate() ?? 0;
    this.emit({
      type: "job",
      job: toPublicJob(row, {
        speedBps: speed,
        fileExists: this.fileExists(row),
      }),
    });
  }

  private fileExists(row: DownloadRow): boolean {
    return existsSync(
      row.status === "completed" ? row.file_path : partPathFor(row.file_path),
    );
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  setSettings(settings: AppSettings): void {
    this.settings = { ...settings };
    this.limiter.setLimit(settings.speedLimitBps);
    mkdirSync(settings.downloadDir, { recursive: true });
    this.emit({ type: "settings", settings: this.getSettings() });
    this.pump();
  }

  listPublicJobs(): PublicJob[] {
    return this.store.listDownloads().map((row) => {
      const runtime = this.active.get(row.id);
      return toPublicJob(runtime?.job ?? row, {
        speedBps: runtime?.meter.rate() ?? 0,
        fileExists: this.fileExists(runtime?.job ?? row),
      });
    });
  }

  getPublicJob(id: string): PublicJob | null {
    const row = this.store.getDownload(id);
    if (!row) return null;
    const runtime = this.active.get(row.id);
    return toPublicJob(runtime?.job ?? row, {
      speedBps: runtime?.meter.rate() ?? 0,
      fileExists: this.fileExists(runtime?.job ?? row),
    });
  }

  addDownload(
    probe: {
      url: string;
      finalUrl: string;
      fileName: string;
      contentType: string;
      totalBytes: number;
      supportsRanges: boolean;
      etag: string | null;
      lastModified: string | null;
    },
    downloadDir: string,
    range?: PartialRangeOptions,
    headers: RequestHeader[] = [],
  ): PublicJob {
    mkdirSync(downloadDir, { recursive: true });
    const rangeStart = Math.max(0, Math.round(range?.start ?? 0));
    const rangeEnd = range?.end == null ? null : Math.round(range.end);
    const partial = isPartialRange(rangeStart, rangeEnd);
    const remoteTotal = Math.max(0, probe.totalBytes);

    if (partial && remoteTotal > 0) {
      if (rangeStart >= remoteTotal) {
        throw new Error("The range start is beyond the end of the remote file.");
      }
      if (rangeEnd !== null && rangeEnd >= remoteTotal) {
        throw new Error("The range end is beyond the end of the remote file.");
      }
    }

    let segmentTotal = remoteTotal;
    if (partial) {
      if (remoteTotal > 0) {
        const end = Math.min(rangeEnd ?? remoteTotal - 1, remoteTotal - 1);
        segmentTotal = Math.max(0, end - rangeStart + 1);
      } else if (rangeEnd !== null) {
        segmentTotal = Math.max(0, rangeEnd - rangeStart + 1);
      } else {
        segmentTotal = 0;
      }
    }

    const baseName = partial
      ? partialFileName(probe.fileName, rangeStart, rangeEnd)
      : sanitizeFileName(probe.fileName, "download");
    const filePath = this.uniqueNewPath(join(downloadDir, baseName));
    const now = Date.now();
    const row = this.store.insertDownload({
      id: randomUUID(),
      url: probe.url,
      finalUrl: probe.finalUrl,
      fileName: basename(filePath),
      filePath,
      contentType: probe.contentType,
      totalBytes: segmentTotal,
      supportsRanges: probe.supportsRanges,
      etag: probe.etag,
      lastModified: probe.lastModified,
      rangeStart: partial ? rangeStart : 0,
      rangeEnd: partial ? rangeEnd : null,
      rangeIf: partial ? (range?.ifRange ?? null) : null,
      remoteTotal,
      headersJson: storedHeadersJson(headers),
      now,
    });
    this.reserved.add(filePath);
    this.emitJob(row);
    this.pump();
    return this.getPublicJob(row.id) ?? toPublicJob(row);
  }

  private uniqueNewPath(candidate: string): string {
    const parsed = parse(candidate);
    let next = candidate;
    let index = 1;
    while (
      existsSync(next) ||
      existsSync(partPathFor(next)) ||
      this.reserved.has(next)
    ) {
      next = join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      index += 1;
    }
    return next;
  }

  private uniqueFinishedPath(candidate: string): string {
    const parsed = parse(candidate);
    let next = candidate;
    let index = 1;
    while (existsSync(next) || this.reserved.has(next)) {
      next = join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      index += 1;
    }
    this.reserved.add(next);
    return next;
  }

  async pause(id: string): Promise<boolean> {
    const row = this.store.getDownload(id);
    if (!row) return false;
    if (row.status === "queued") {
      const updated = this.store.setStatus(id, "paused");
      if (updated) this.emitJob(updated);
      return true;
    }
    if (row.status !== "downloading") return false;

    const runtime = this.active.get(id);
    const updated = this.store.setStatus(id, "paused", {
      downloaded_bytes: runtime?.job.downloaded_bytes ?? row.downloaded_bytes,
      total_bytes: runtime?.job.total_bytes ?? row.total_bytes,
    });
    if (runtime) runtime.job.status = "paused";
    if (updated) this.emitJob(updated);
    runtime?.controller.abort();
    await this.waitFor(runtime);
    return true;
  }

  async resume(id: string): Promise<boolean> {
    const row = this.store.getDownload(id);
    if (!row || row.status !== "paused") return false;
    const updated = this.store.setStatus(id, "queued", { error: null });
    if (updated) this.emitJob(updated);
    this.pump();
    return true;
  }

  async retry(id: string): Promise<boolean> {
    const row = this.store.getDownload(id);
    if (!row) return false;
    if (!["error", "canceled", "paused"].includes(row.status)) return false;
    if (row.status === "paused" && this.active.has(id)) return false;
    const updated = this.store.setStatus(id, "queued", { error: null });
    if (updated) this.emitJob(updated);
    this.pump();
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const row = this.store.getDownload(id);
    if (!row) return false;
    if (row.status === "completed") return false;
    if (row.status === "downloading") {
      const runtime = this.active.get(id);
      this.store.setStatus(id, "canceled", {
        downloaded_bytes: runtime?.job.downloaded_bytes ?? row.downloaded_bytes,
        error: null,
      });
      if (runtime) runtime.job.status = "canceled";
      runtime?.controller.abort();
      await this.waitFor(runtime);
    } else {
      this.store.setStatus(id, "canceled", { error: null });
    }
    const current = this.store.getDownload(id);
    if (current) {
      await rm(partPathFor(current.file_path), { force: true });
      const updated = this.store.patch(id, {
        downloaded_bytes: 0,
        speed_bps: 0,
      });
      if (updated) this.emitJob(updated);
    }
    return true;
  }

  async remove(id: string, deleteFiles = true): Promise<boolean> {
    const row = this.store.getDownload(id);
    if (!row) return false;

    if (this.active.has(id)) {
      const runtime = this.active.get(id);
      if (row.status === "downloading") {
        this.store.setStatus(id, "canceled", { error: null });
        if (runtime) runtime.job.status = "canceled";
      }
      runtime?.controller.abort();
      await this.waitFor(runtime);
    }

    const current = this.store.getDownload(id);
    if (!current) return false;
    if (deleteFiles) {
      await Promise.all([
        rm(current.file_path, { force: true }),
        rm(partPathFor(current.file_path), { force: true }),
      ]);
    }
    this.reserved.delete(current.file_path);
    this.store.deleteDownload(id);
    this.emit({ type: "deleted", id });
    return true;
  }

  async pauseAll(): Promise<number> {
    let changed = this.store.setAllStatus("queued", "paused");
    changed += this.store.setAllStatus("downloading", "paused");
    for (const runtime of this.active.values()) {
      runtime.job.status = "paused";
      runtime.controller.abort();
    }
    await Promise.allSettled([...this.active.values()].map((r) => r.done));
    this.emit({ type: "refresh" });
    return changed;
  }

  async resumeAll(): Promise<number> {
    const changed = this.store.setAllStatus("paused", "queued");
    this.emit({ type: "refresh" });
    this.pump();
    return changed;
  }

  async clearCompleted(): Promise<number> {
    const completed = this.store
      .listDownloads()
      .filter((row) => row.status === "completed");
    if (completed.length === 0) return 0;
    for (const row of completed) this.reserved.delete(row.file_path);
    const count = this.store.clearTerminal(["completed"]);
    this.emit({ type: "refresh" });
    return count;
  }

  async clearHistory(): Promise<number> {
    const terminal = this.store
      .listDownloads()
      .filter((row) => ["error", "canceled"].includes(row.status));
    for (const row of terminal) {
      await rm(partPathFor(row.file_path), { force: true });
      this.reserved.delete(row.file_path);
    }
    const changed = this.store.clearTerminal(["error", "canceled"]);
    this.emit({ type: "refresh" });
    return changed;
  }

  private waitFor(runtime: Runtime | undefined): Promise<void> {
    if (!runtime) return Promise.resolve();
    return Promise.race([
      runtime.done,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }

  private pump(): void {
    if (this.stopping || this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      if (this.stopping) return;
      while (this.active.size < this.settings.maxConcurrent) {
        const next = this.store.nextQueued();
        if (!next) break;
        this.start(next);
      }
    });
  }

  startQueued(): void {
    this.pump();
  }

  private start(row: DownloadRow): void {
    const startedAt = row.started_at ?? Date.now();
    const updated = this.store.setStatus(row.id, "downloading", {
      started_at: startedAt,
      attempts: row.attempts + 1,
      error: null,
      speed_bps: 0,
    });
    if (!updated) return;

    const controller = new AbortController();
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const runtime: Runtime = {
      controller,
      done,
      resolveDone,
      job: updated,
      meter: new SpeedMeter(updated.downloaded_bytes),
      lastPersist: Date.now(),
      lastEmit: 0,
    };
    this.active.set(row.id, runtime);
    this.emitJob(updated, runtime.meter);

    void this.run(updated, runtime)
      .catch((error) => {
        if (!this.store.getDownload(row.id)) return;
        const latest = this.store.getDownload(row.id);
        if (!latest) return;
        if (this.stopping) {
          this.store.setStatus(row.id, "paused", { error: null });
        } else if (latest.status === "downloading") {
          this.store.setStatus(row.id, "error", {
            error: errorMessage(error),
            downloaded_bytes: runtime.job.downloaded_bytes,
          });
        }
      })
      .finally(() => {
        const latest = this.store.getDownload(row.id);
        if (latest) {
          const final = this.store.patch(row.id, {
            downloaded_bytes: runtime.job.downloaded_bytes,
            total_bytes: runtime.job.total_bytes,
            etag: runtime.job.etag,
            last_modified: runtime.job.last_modified,
            supports_ranges: runtime.job.supports_ranges,
            remote_total: runtime.job.remote_total,
            http_status: runtime.job.http_status,
            speed_bps: 0,
          });
          if (final) this.emitJob(final);
        }
        this.active.delete(row.id);
        resolveDone();
        this.pump();
      });
  }

  private async acquireResponse(
    job: DownloadRow,
    downloaded: number,
    signal: AbortSignal,
    restart = false,
  ): Promise<{ response: Response; start: number }> {
    const headers = buildRequestHeaders(
      parseStoredHeaders(job.headers_json),
    );
    const partial = isPartialRange(job.range_start, job.range_end);
    const requestStart = job.range_start + downloaded;
    const needsRange = partial || downloaded > 0;

    if (needsRange) {
      headers.set(
        "Range",
        `bytes=${requestStart}-${job.range_end !== null ? job.range_end : ""}`,
      );
      const validator = job.range_if || job.etag || job.last_modified;
      if (validator) headers.set("If-Range", validator);
    }

    const response = await fetch(job.final_url || job.url, {
      headers,
      redirect: "follow",
      signal,
    });

    if (needsRange && response.status === 200) {
      if (partial) {
        await response.body?.cancel();
        throw new DownloadFailure(
          "The server ignored the Range request or the file validator changed (HTTP 200 instead of 206 Partial Content).",
          200,
        );
      }
      // A normal in-progress download can restart from zero when the server
      // ignores its range or the entity changed.
      return { response, start: 0 };
    }

    if (needsRange && response.status === 206) {
      const range = parseContentRange(response.headers.get("content-range"));
      if (!range || range.start !== requestStart) {
        await response.body?.cancel();
        if (partial) {
          throw new DownloadFailure(
            "The server returned an unexpected byte range for this partial download.",
          );
        }
        if (restart) {
          throw new DownloadFailure(
            "The server returned an unexpected byte range. Try again.",
          );
        }
        return this.acquireResponse(job, 0, signal, true);
      }
    }

    return { response, start: downloaded };
  }

  private async run(job: DownloadRow, runtime: Runtime): Promise<void> {
    const partPath = partPathFor(job.file_path);
    const partial = isPartialRange(job.range_start, job.range_end);
    await mkdir(dirname(job.file_path), { recursive: true });

    let downloaded = Math.max(0, job.downloaded_bytes);
    let total = Math.max(0, job.total_bytes);
    try {
      // If the process died after renaming the part file but before the
      // database recorded completion, adopt the finished file instead of
      // downloading it again.
      if (total > 0 && existsSync(job.file_path)) {
        const finalSize = (await stat(job.file_path)).size;
        if (finalSize === total) {
          job.downloaded_bytes = total;
          job.speed_bps = 0;
          const completed = this.store.patch(job.id, {
            downloaded_bytes: total,
            total_bytes: total,
            status: "completed",
            error: null,
            completed_at: Date.now(),
            speed_bps: 0,
          });
          if (completed) this.emitJob(completed);
          return;
        }
      }

      let partSize = 0;
      try {
        partSize = (await stat(partPath)).size;
      } catch {
        partSize = 0;
      }
      if (partSize !== downloaded) {
        downloaded = partSize;
        job.downloaded_bytes = downloaded;
        runtime.meter.set(downloaded);
      }

      if (total > 0 && downloaded >= total) {
        await this.finishSuccess(job, runtime, downloaded, total);
        return;
      }

      const { response, start } = await this.acquireResponse(
        job,
        downloaded,
        runtime.controller.signal,
      );

      if (response.status === 416) {
        const remoteTotal = parseUnsatisfiedTotal(
          response.headers.get("content-range"),
        );
        await response.body?.cancel();
        if (remoteTotal !== null) {
          job.remote_total = remoteTotal;
          if (!partial) {
            total = remoteTotal;
            job.total_bytes = total;
          }
        }
        if (total > 0 && downloaded >= total) {
          await this.finishSuccess(job, runtime, downloaded, total);
          return;
        }
        throw new DownloadFailure(
          partial
            ? "The requested range can't be satisfied. The file may have changed, or the range is outside the remote file."
            : "The remote file changed and the partial download can't be resumed. Remove it and start again.",
          416,
        );
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw httpFailure(response);
      }
      if (!response.body) {
        throw new DownloadFailure("The remote server returned an empty body.");
      }

      if (start === 0 && downloaded > 0) {
        downloaded = 0;
        job.downloaded_bytes = 0;
        runtime.meter.set(0);
        await truncate(partPath, 0);
      }

      const contentRange = parseContentRange(
        response.headers.get("content-range"),
      );
      if (response.status === 206) {
        if (contentRange) {
          if (contentRange.total != null) {
            job.remote_total = contentRange.total;
          }
          if (partial) {
            total = Math.max(
              0,
              contentRange.end - job.range_start + 1,
            );
          } else {
            total = contentRange.total ?? total;
          }
        }
        job.supports_ranges = 1;
      } else {
        const length = headerNumber(response.headers.get("content-length"));
        if (length > 0) {
          total = length;
          job.remote_total = length;
        }
        if (downloaded > 0) job.supports_ranges = 0;
      }
      job.total_bytes = total;
      job.http_status = response.status;
      if (response.headers.get("etag")) job.etag = response.headers.get("etag");
      if (response.headers.get("last-modified")) {
        job.last_modified = response.headers.get("last-modified");
      }
      this.store.patch(job.id, {
        total_bytes: job.total_bytes,
        supports_ranges: job.supports_ranges,
        remote_total: job.remote_total,
        http_status: job.http_status,
        etag: job.etag,
        last_modified: job.last_modified,
      });

      const handle = await open(partPath, "a");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (runtime.controller.signal.aborted) {
            throw runtime.controller.signal.reason ??
              new DOMException("Aborted", "AbortError");
          }
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          await this.limiter.take(bytes.byteLength, runtime.controller.signal);
          await handle.write(bytes);
          downloaded += bytes.byteLength;
          job.downloaded_bytes = downloaded;
          runtime.meter.add(bytes.byteLength);

          const now = Date.now();
          if (now - runtime.lastPersist >= 800) {
            runtime.lastPersist = now;
            const speed = runtime.meter.rate(now);
            job.speed_bps = speed;
            this.store.patch(job.id, {
              downloaded_bytes: downloaded,
              total_bytes: total,
              speed_bps: speed,
              remote_total: job.remote_total,
              http_status: job.http_status,
            });
          }
          if (now - runtime.lastEmit >= 220) {
            runtime.lastEmit = now;
            this.emitJob(job, runtime.meter);
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* the stream may already be closed or aborted */
        }
        reader.releaseLock();
        await handle.close();
      }

      const actualSize = (await stat(partPath)).size;
      if (actualSize !== downloaded) downloaded = actualSize;
      if (total > 0 && downloaded < total) {
        throw new DownloadFailure(
          `The connection closed early (${downloaded} of ${total} bytes). The download can resume.`,
        );
      }
      if (total <= 0) total = downloaded;

      await this.finishSuccess(job, runtime, downloaded, total);
    } catch (error) {
      const latest = this.store.getDownload(job.id);
      if (latest?.status === "downloading" && !this.stopping) {
        this.store.setStatus(job.id, "error", {
          error: errorMessage(error),
          downloaded_bytes: downloaded,
          total_bytes: total,
          etag: job.etag,
          last_modified: job.last_modified,
          supports_ranges: job.supports_ranges,
          remote_total: job.remote_total,
          http_status: job.http_status,
        });
      } else if (latest) {
        this.store.patch(job.id, {
          downloaded_bytes: downloaded,
          total_bytes: total,
          etag: job.etag,
          last_modified: job.last_modified,
          supports_ranges: job.supports_ranges,
          remote_total: job.remote_total,
          http_status: job.http_status,
        });
      }
      throw error;
    }
  }

  private async finishSuccess(
    job: DownloadRow,
    runtime: Runtime,
    downloaded: number,
    total: number,
  ): Promise<void> {
    const partPath = partPathFor(job.file_path);
    this.reserved.delete(job.file_path);
    const finalPath = this.uniqueFinishedPath(job.file_path);
    if (existsSync(partPath)) {
      await rename(partPath, finalPath);
    } else if (!existsSync(finalPath)) {
      throw new DownloadFailure("The downloaded file disappeared before it could be saved.");
    }

    job.downloaded_bytes = downloaded;
    job.total_bytes = total > 0 ? total : downloaded;
    job.file_path = finalPath;
    job.file_name = basename(finalPath);
    job.speed_bps = 0;
    runtime.job = job;

    const completed = this.store.patch(job.id, {
      downloaded_bytes: job.downloaded_bytes,
      total_bytes: job.total_bytes,
      file_path: finalPath,
      file_name: job.file_name,
      etag: job.etag,
      last_modified: job.last_modified,
      supports_ranges: job.supports_ranges,
      remote_total: job.remote_total,
      http_status: job.http_status,
      status: "completed",
      error: null,
      completed_at: Date.now(),
      speed_bps: 0,
    });
    if (completed) this.emitJob(completed);
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    const runtimes = [...this.active.values()];
    for (const [id, runtime] of this.active) {
      const row = this.store.getDownload(id);
      if (row?.status === "downloading") {
        this.store.setStatus(id, "paused", {
          downloaded_bytes: runtime.job.downloaded_bytes,
          total_bytes: runtime.job.total_bytes,
          speed_bps: 0,
        });
        runtime.job.status = "paused";
      }
      runtime.controller.abort();
    }
    await Promise.allSettled(runtimes.map((runtime) => runtime.done));
  }

  activeCount(): number {
    return this.active.size;
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /** Recover jobs after a restart. */
  recover(): number {
    const reset = this.store.resetInterrupted();
    this.pump();
    this.emit({ type: "refresh" });
    return reset;
  }

  statusOf(id: string): JobStatus | null {
    return this.store.getDownload(id)?.status ?? null;
  }
}

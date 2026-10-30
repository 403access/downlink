import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import index from "./index.html";
import { Store, partPathFor } from "./db";
import { DownloadEngine } from "./engine";
import { ProbeError, probeUrl } from "./probe";
import type { AppSettings, DownloadRow, PublicJob } from "./types";
import {
  contentTypeForFile,
  contentDisposition,
  DOWNLOAD_HEADERS,
  expandHome,
  kindFor,
  normalizeDownloadUrl,
  parseRangeHeader,
} from "./utils";

const ROOT = resolve(import.meta.dir, "..");
const DATA_DIR = process.env.DATA_DIR
  ? expandHome(process.env.DATA_DIR)
  : join(ROOT, "data");
const DEFAULT_DOWNLOAD_DIR = process.env.DOWNLOAD_DIR
  ? expandHome(process.env.DOWNLOAD_DIR)
  : join(ROOT, "downloads");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_BATCH = 25;
const PROBE_CONCURRENCY = 4;
const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const STARTED_AT = Date.now();
const VERSION = "1.0.0";

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });

const store = new Store(join(DATA_DIR, "downlink.db"));
const defaults: AppSettings = {
  downloadDir: DEFAULT_DOWNLOAD_DIR,
  maxConcurrent: 3,
  speedLimitBps: 0,
};
const savedSettings = store.getSettings(defaults);
const settings: AppSettings = {
  ...savedSettings,
  downloadDir: expandHome(savedSettings.downloadDir || DEFAULT_DOWNLOAD_DIR),
};
mkdirSync(settings.downloadDir, { recursive: true });
store.saveSettings(settings);

const engine = new DownloadEngine(store, settings);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ParamsRequest = Request & { params: Record<string, string> };

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof ProbeError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return json({ error: message }, 500);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError("Expected a JSON request body.", 415);
  }
  const text = await req.text();
  if (text.length > 1_000_000) throw new HttpError("Request body is too large.", 413);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError("Expected a JSON object.", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("Invalid JSON.", 400);
  }
}

function jobId(req: Request): string {
  const id = (req as ParamsRequest).params?.id;
  if (!id) throw new HttpError("Missing download id.", 400);
  return id;
}

function summarize(jobs: PublicJob[]) {
  let speedBps = 0;
  let bytesOnDisk = 0;
  let completedBytes = 0;
  let downloading = 0;
  let queued = 0;
  let completed = 0;
  let paused = 0;
  let failed = 0;
  let canceled = 0;

  for (const job of jobs) {
    speedBps += job.speedBps;
    bytesOnDisk += job.downloadedBytes;
    if (job.status === "downloading") downloading += 1;
    if (job.status === "queued") queued += 1;
    if (job.status === "completed") {
      completed += 1;
      completedBytes += job.totalBytes || job.downloadedBytes;
    }
    if (job.status === "paused") paused += 1;
    if (job.status === "error") failed += 1;
    if (job.status === "canceled") canceled += 1;
  }

  return {
    total: jobs.length,
    active: downloading + queued,
    downloading,
    queued,
    completed,
    paused,
    failed,
    canceled,
    speedBps,
    bytesOnDisk,
    completedBytes,
    downloadDir: engine.getSettings().downloadDir,
  };
}

function snapshot() {
  const jobs = engine.listPublicJobs();
  return { jobs, summary: summarize(jobs), settings: engine.getSettings() };
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const PREVIEW_SECRET = randomBytes(32);

function makePreviewToken(rawUrl: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: rawUrl, e: Date.now() + PREVIEW_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", PREVIEW_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function readPreviewToken(token: string): URL {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new HttpError("Invalid preview token.", 403);
  const expected = createHmac("sha256", PREVIEW_SECRET)
    .update(payload)
    .digest("base64url");
  if (!safeCompare(signature, expected)) {
    throw new HttpError("Invalid preview token.", 403);
  }
  let parsed: { u?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u?: unknown;
      e?: unknown;
    };
  } catch {
    throw new HttpError("Invalid preview token.", 403);
  }
  if (typeof parsed.e !== "number" || parsed.e < Date.now()) {
    throw new HttpError("This preview link expired. Inspect the URL again.", 403);
  }
  if (typeof parsed.u !== "string") throw new HttpError("Invalid preview token.", 403);
  return normalizeDownloadUrl(parsed.u);
}

function jobAndFile(id: string): { job: DownloadRow; path: string } {
  const job = store.getDownload(id);
  if (!job) throw new HttpError("Download not found.", 404);
  const path = job.status === "completed" ? job.file_path : partPathFor(job.file_path);
  if (!existsSync(path)) {
    throw new HttpError(
      job.status === "completed"
        ? "The downloaded file is no longer on disk."
        : "There are no downloaded bytes to preview yet.",
      404,
    );
  }
  return { job, path };
}

async function serveFile(
  req: Request,
  path: string,
  contentType: string,
  fileName: string,
  disposition: "inline" | "attachment",
): Promise<Response> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return json({ error: "File not found." }, 404);
  }

  const range = parseRangeHeader(req.headers.get("range"), size);
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": contentDisposition(fileName, disposition),
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
  if (disposition === "inline") {
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  }

  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    const length = range.end - range.start + 1;
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(length));
    if (req.method === "HEAD") {
      return new Response(null, { status: 206, headers });
    }
    return new Response(Bun.file(path).slice(range.start, range.end + 1), {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(size));
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(Bun.file(path), { status: 200, headers });
}

function fileNameFromJob(job: DownloadRow): string {
  return job.file_name || "download";
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, Math.max(1, items.length)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await mapper(item, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function addUrls(rawUrls: string[]) {
  const urls = [...new Set(rawUrls.map((value) => value.trim()).filter(Boolean))];
  if (urls.length === 0) throw new HttpError("Paste at least one URL.", 400);
  if (urls.length > MAX_BATCH) {
    throw new HttpError(`You can add up to ${MAX_BATCH} URLs at once.`, 400);
  }

  const results = await withConcurrency(urls, PROBE_CONCURRENCY, async (url) => {
    try {
      const probe = await probeUrl(url);
      const job = engine.addDownload(probe, engine.getSettings().downloadDir);
      return { url, job, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not inspect this URL.";
      return { url, job: null, error: message };
    }
  });

  const jobs = results.flatMap((result) => (result.job ? [result.job] : []));
  const errors = results.flatMap((result) =>
    result.error ? [{ url: result.url, error: result.error }] : [],
  );
  return { jobs, errors };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120,
  routes: {
    "/": index,
    "/favicon.ico": {
      GET: () =>
        new Response(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#b6f36b"/><path d="M32 14v27m0 0-10-10m10 10 10-10M18 50h28" fill="none" stroke="#101411" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" } },
        ),
    },
    "/manifest.webmanifest": {
      GET: () =>
        json(
          {
            name: "Downlink",
            short_name: "Downlink",
            description: "Local-first resumable downloader",
            start_url: "/",
            display: "standalone",
            background_color: "#0b0e0f",
            theme_color: "#b6f36b",
            icons: [],
          },
          200,
          { "Content-Type": "application/manifest+json" },
        ),
    },

    "/api/health": {
      GET: () =>
        json({
          ok: true,
          version: VERSION,
          uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
          active: engine.activeCount(),
          downloadDir: engine.getSettings().downloadDir,
        }),
    },

    "/api/downloads": {
      GET: () => json(snapshot()),
      POST: async (req) => {
        const body = await readJson(req);
        const raw: string[] = [];
        if (typeof body.url === "string") raw.push(body.url);
        if (Array.isArray(body.urls)) {
          for (const value of body.urls) {
            if (typeof value === "string") raw.push(value);
          }
        }
        if (raw.length === 0) throw new HttpError("A URL is required.", 400);
        const result = await addUrls(raw);
        if (result.jobs.length === 0) {
          return json(
            {
              error: result.errors[0]?.error ?? "No downloads could be added.",
              errors: result.errors,
            },
            422,
          );
        }
        return json(result, 201);
      },
    },

    "/api/downloads/:id": {
      GET: (req) => {
        const job = engine.getPublicJob(jobId(req));
        if (!job) return json({ error: "Download not found." }, 404);
        return json({ job });
      },
      DELETE: async (req) => {
        const id = jobId(req);
        const removeFile = new URL(req.url).searchParams.get("files") !== "false";
        const ok = await engine.remove(id, removeFile);
        if (!ok) return json({ error: "Download not found." }, 404);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/pause": {
      POST: async (req) => {
        const ok = await engine.pause(jobId(req));
        if (!ok) return json({ error: "This download cannot be paused." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/resume": {
      POST: async (req) => {
        const ok = await engine.resume(jobId(req));
        if (!ok) return json({ error: "This download cannot be resumed." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/retry": {
      POST: async (req) => {
        const ok = await engine.retry(jobId(req));
        if (!ok) return json({ error: "This download cannot be retried." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/cancel": {
      POST: async (req) => {
        const ok = await engine.cancel(jobId(req));
        if (!ok) return json({ error: "This download cannot be canceled." }, 409);
        return json({ ok: true });
      },
    },

    "/api/downloads/:id/reveal": {
      POST: async (req) => {
        const job = store.getDownload(jobId(req));
        if (!job) return json({ error: "Download not found." }, 404);
        const target = existsSync(job.file_path) ? job.file_path : engine.getSettings().downloadDir;
        return openInFileManager(target, existsSync(job.file_path));
      },
    },

    "/api/downloads/:id/preview": {
      GET: (req) => previewResponse(req),
      HEAD: (req) => previewResponse(req),
    },

    "/api/preview/:id": {
      GET: (req) => previewResponse(req),
      HEAD: (req) => previewResponse(req),
    },

    "/api/files/:id": {
      GET: (req) => attachmentResponse(req),
      HEAD: (req) => attachmentResponse(req),
    },

    "/api/downloads/:id/file": {
      GET: (req) => {
        const { job, path } = jobAndFile(jobId(req));
        if (job.status !== "completed") {
          return json({ error: "The download is not complete yet." }, 409);
        }
        return serveFile(
          req,
          path,
          contentTypeForFile(job.file_name, job.content_type),
          fileNameFromJob(job),
          "attachment",
        );
      },
      HEAD: (req) => {
        const { job, path } = jobAndFile(jobId(req));
        if (job.status !== "completed") {
          return json({ error: "The download is not complete yet." }, 409);
        }
        return serveFile(
          req,
          path,
          contentTypeForFile(job.file_name, job.content_type),
          fileNameFromJob(job),
          "attachment",
        );
      },
    },

    "/api/actions/pause-all": {
      POST: async () => json({ ok: true, changed: await engine.pauseAll() }),
    },
    "/api/actions/resume-all": {
      POST: async () => json({ ok: true, changed: await engine.resumeAll() }),
    },
    "/api/actions/clear-completed": {
      POST: async () => json({ ok: true, changed: await engine.clearCompleted() }),
    },
    "/api/actions/clear-history": {
      POST: async () => json({ ok: true, changed: await engine.clearHistory() }),
    },
    "/api/actions/open-folder": {
      POST: async () =>
        openInFileManager(engine.getSettings().downloadDir, false),
    },

    "/api/inspect": {
      POST: async (req) => {
        const body = await readJson(req);
        if (typeof body.url !== "string") throw new HttpError("A URL is required.", 400);
        const probe = await probeUrl(body.url);
        const canPreview = ["video", "audio", "image"].includes(probe.kind);
        return json({
          probe,
          canPreview,
          previewUrl: canPreview
            ? `/api/remote-preview?token=${encodeURIComponent(
                makePreviewToken(probe.finalUrl),
              )}`
            : null,
        });
      },
    },

    "/api/remote-preview": {
      GET: async (req) => {
        const token = new URL(req.url).searchParams.get("token");
        if (!token) throw new HttpError("Missing preview token.", 403);
        const url = readPreviewToken(token);
        const headers: Record<string, string> = { ...DOWNLOAD_HEADERS };
        const range = req.headers.get("range");
        if (range) headers.Range = range;
        const ifRange = req.headers.get("if-range");
        if (ifRange) headers["If-Range"] = ifRange;

        const upstream = await fetch(url, {
          headers,
          redirect: "follow",
          signal: req.signal,
        });
        const out = new Headers();
        for (const name of [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "etag",
          "last-modified",
        ]) {
          const value = upstream.headers.get(name);
          if (value) out.set(name, value);
        }
        out.set("Content-Disposition", `inline; filename="preview"`);
        out.set("Cache-Control", "private, no-store");
        out.set("X-Content-Type-Options", "nosniff");
        out.set("Content-Security-Policy", "sandbox; default-src 'none'");
        return new Response(req.method === "HEAD" ? null : upstream.body, {
          status: upstream.status,
          headers: out,
        });
      },
      HEAD: async (req) => {
        const token = new URL(req.url).searchParams.get("token");
        if (!token) throw new HttpError("Missing preview token.", 403);
        const url = readPreviewToken(token);
        const upstream = await fetch(url, {
          method: "HEAD",
          headers: DOWNLOAD_HEADERS,
          redirect: "follow",
          signal: req.signal,
        });
        return new Response(null, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
            "Content-Length": upstream.headers.get("content-length") ?? "0",
            "Content-Disposition": `inline; filename="preview"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },

    "/api/settings": {
      GET: () => json({ settings: engine.getSettings() }),
      PATCH: async (req) => {
        const body = await readJson(req);
        const current = engine.getSettings();
        const next: AppSettings = { ...current };

        if (body.downloadDir !== undefined) {
          if (typeof body.downloadDir !== "string" || !body.downloadDir.trim()) {
            throw new HttpError("Choose a valid download folder.", 400);
          }
          if (body.downloadDir.length > 1024) {
            throw new HttpError("That folder path is too long.", 400);
          }
          const dir = expandHome(body.downloadDir);
          try {
            mkdirSync(dir, { recursive: true });
            await access(dir, constants.W_OK);
          } catch {
            throw new HttpError("That folder is not writable.", 400);
          }
          next.downloadDir = dir;
        }

        if (body.maxConcurrent !== undefined) {
          const value = Number(body.maxConcurrent);
          if (!Number.isInteger(value) || value < 1 || value > 10) {
            throw new HttpError("Simultaneous downloads must be between 1 and 10.", 400);
          }
          next.maxConcurrent = value;
        }

        if (body.speedLimitBps !== undefined) {
          const value = Number(body.speedLimitBps);
          if (!Number.isFinite(value) || value < 0 || value > 10_000_000_000) {
            throw new HttpError("Speed limit must be zero or a positive value.", 400);
          }
          next.speedLimitBps = Math.round(value);
        }

        store.saveSettings(next);
        engine.setSettings(next);
        return json({ settings: engine.getSettings() });
      },
    },

    "/api/events": {
      GET: (req) => eventStream(req),
    },
  },

  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/api/")) {
      return json({ error: "API route not found." }, 404);
    }
    return new Response("Not found", { status: 404 });
  },

  error(error) {
    if (!(error instanceof ProbeError) && !(error instanceof HttpError)) {
      console.error("[downlink]", error);
    }
    return errorResponse(error);
  },
});

function previewResponse(req: Request): Promise<Response> | Response {
  try {
    const { job, path } = jobAndFile(jobId(req));
    const kind = kindFor(job.content_type, job.file_name);
    if (!["video", "audio", "image"].includes(kind)) {
      return json({ error: "This file type cannot be previewed." }, 415);
    }
    return serveFile(
      req,
      path,
      contentTypeForFile(job.file_name, job.content_type),
      fileNameFromJob(job),
      "inline",
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function attachmentResponse(req: Request): Promise<Response> | Response {
  try {
    const { job, path } = jobAndFile(jobId(req));
    if (job.status !== "completed") {
      return json({ error: "The download is not complete yet." }, 409);
    }
    return serveFile(
      req,
      path,
      contentTypeForFile(job.file_name, job.content_type),
      fileNameFromJob(job),
      "attachment",
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function eventStream(req: Request): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send("snapshot", snapshot());
      unsubscribe = engine.subscribe((event) => {
        if (event.type === "job") send("job", event.job);
        else if (event.type === "deleted") send("deleted", { id: event.id });
        else if (event.type === "settings") send("settings", { settings: event.settings });
        else if (event.type === "refresh") send("refresh", {});
      });
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function openInFileManager(path: string, reveal: boolean): Promise<Response> {
  let command: string[];
  if (process.platform === "darwin") {
    command = reveal ? ["open", "-R", path] : ["open", path];
  } else if (process.platform === "win32") {
    command = reveal
      ? ["explorer", `/select,${path}`]
      : ["explorer", path];
  } else {
    command = ["xdg-open", reveal ? dirname(path) : path];
  }

  try {
    const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    const timeout = setTimeout(() => proc.kill(), 4_000);
    await proc.exited;
    clearTimeout(timeout);
    return json({ ok: true });
  } catch {
    return json({ error: "Could not open the system file manager." }, 500);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

engine.recover();

console.log(
  `\n  Downlink ${VERSION}\n  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${server.port}\n  Saving files to ${engine.getSettings().downloadDir}\n`,
);

if (HOST === "0.0.0.0") {
  console.warn(
    "  Warning: Downlink is listening on all interfaces. Only do this on a network you trust.\n",
  );
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n  Pausing active downloads…");
  await engine.shutdown();
  server.stop(true);
  try {
    store.close();
  } catch {
    /* already closed */
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { partPathFor } from "../db";
import type { DownloadRow } from "../types";
import {
  contentDisposition,
  contentTypeForFile,
  kindFor,
  parseRangeHeader,
} from "../utils";
import { store } from "./context";
import { HttpError, jobId, json } from "./http";
import { growingFileStream } from "./stream";

interface ServeFileOptions {
  /** Stream bytes that have not been written yet instead of ending at EOF. */
  live?: boolean;
  /** The size the file is expected to reach. */
  expectedSize?: number;
  /** Whether the writer can still append data. */
  isLive?: () => boolean;
  /** Final path to use if the partial file is renamed mid-stream. */
  fallbackPath?: string;
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

function baseHeaders(
  contentType: string,
  fileName: string,
  disposition: "inline" | "attachment",
): Headers {
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
  return headers;
}

async function serveFile(
  req: Request,
  path: string,
  contentType: string,
  fileName: string,
  disposition: "inline" | "attachment",
  options: ServeFileOptions = {},
): Promise<Response> {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return json({ error: "File not found." }, 404);
  }

  const headers = baseHeaders(contentType, fileName, disposition);

  if (options.live) {
    const expected = Math.max(size, options.expectedSize ?? 0);
    if (expected > 0) {
      const requested = req.headers.get("range");
      const range = parseRangeHeader(requested, expected);
      if (range === "invalid") {
        headers.set("Content-Range", `bytes */${expected}`);
        return new Response(null, { status: 416, headers });
      }

      const start = range ? range.start : 0;
      const end = range ? range.end : expected - 1;
      const length = end - start + 1;
      if (range) {
        headers.set("Content-Range", `bytes ${start}-${end}/${expected}`);
      }
      headers.set("Content-Length", String(length));

      if (req.method === "HEAD") {
        return new Response(null, { status: range ? 206 : 200, headers });
      }

      return new Response(
        growingFileStream(path, start, end, {
          signal: req.signal,
          isLive: options.isLive,
          fallbackPath: options.fallbackPath,
        }),
        { status: range ? 206 : 200, headers },
      );
    }
  }

  const range = parseRangeHeader(req.headers.get("range"), size);

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

/** Whether the job may still write more bytes to its `.part` file. */
function stillWriting(job: DownloadRow): boolean {
  const current = store.getDownload(job.id);
  return Boolean(
    current && ["queued", "downloading", "paused"].includes(current.status),
  );
}

export function previewResponse(req: Request): Promise<Response> | Response {
  try {
    const { job, path } = jobAndFile(jobId(req));
    const kind = kindFor(job.content_type, job.file_name);
    if (!["video", "audio", "image"].includes(kind)) {
      return json({ error: "This file type cannot be previewed." }, 415);
    }
    const partial = job.range_start > 0 || job.range_end !== null;
    const live = job.status !== "completed" && kind !== "image";
    return serveFile(
      req,
      path,
      contentTypeForFile(job.file_name, job.content_type),
      fileNameFromJob(job),
      "inline",
      {
        // Images are loaded as a single resource, so a growing stream would
        // keep them waiting. Media elements can follow a live byte stream.
        live,
        expectedSize:
          job.total_bytes > 0
            ? job.total_bytes
            : partial
              ? 0
              : job.remote_total,
        isLive: () => stillWriting(job),
        fallbackPath: live ? job.file_path : undefined,
      },
    );
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "Could not read the file." }, 500);
  }
}

export function attachmentResponse(req: Request): Promise<Response> | Response {
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
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "Could not read the file." }, 500);
  }
}

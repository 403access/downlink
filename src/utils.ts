import { basename, extname, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { parseStoredHeaders } from "./headers";
import type {
  DownloadRow,
  FileKind,
  ProbeResult,
  PublicJob,
} from "./types";

const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpeg",
  "video/x-m4v": "m4v",
  "video/ogg": "ogv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-7z-compressed": "7z",
  "application/x-rar-compressed": "rar",
  "application/gzip": "gz",
  "application/x-tar": "tar",
  "application/json": "json",
  "text/plain": "txt",
  "text/html": "html",
};

const EXTENSION_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  tar: "application/x-tar",
  json: "application/json",
  txt: "text/plain",
};

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "webm",
  "mov",
  "mkv",
  "avi",
  "ogv",
  "mpeg",
  "mpg",
  "ts",
  "m3u8",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac",
  "aiff",
]);
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "svg",
  "bmp",
]);
const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "7z",
  "rar",
  "gz",
  "tar",
  "bz2",
  "xz",
  "dmg",
  "iso",
]);
const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "epub",
  "json",
  "csv",
]);

export function fileExtension(fileName: string): string {
  return extname(fileName).slice(1).toLowerCase();
}

export function normalizeContentType(
  raw: string | null | undefined,
  fileName = "",
): string {
  const value = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    value &&
    value !== "application/octet-stream" &&
    value !== "binary/octet-stream"
  ) {
    return value;
  }
  return EXTENSION_MIME[fileExtension(fileName)] ?? value ?? "";
}

export function kindFor(contentType: string, fileName = ""): FileKind {
  const type = normalizeContentType(contentType, fileName);
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";

  const ext = fileExtension(fileName);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "other";
}

export function extensionForContentType(contentType: string): string | null {
  return MIME_EXTENSIONS[normalizeContentType(contentType)] ?? null;
}

export function contentTypeForFile(
  fileName: string,
  fallback = "application/octet-stream",
): string {
  const normalized = normalizeContentType(fallback, fileName);
  if (
    normalized &&
    normalized !== "application/octet-stream" &&
    normalized !== "binary/octet-stream"
  ) {
    return normalized;
  }
  return EXTENSION_MIME[fileExtension(fileName)] ?? "application/octet-stream";
}

/** Turn arbitrary remote names into a safe basename while preserving an extension. */
export function sanitizeFileName(input: string, fallback = "download"): string {
  // Never trust a path component supplied by a remote server. Take the
  // basename before replacing characters so traversal segments disappear.
  let name = basename(input.replaceAll("\\", "/"))
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "");

  if (!name) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
    name = `_${name}`;
  }

  if (name.length > 180) {
    const ext = extname(name);
    name = `${name.slice(0, Math.max(1, 180 - ext.length))}${ext}`;
  }

  // Filesystems usually cap a single name at 255 bytes, not characters.
  if (Buffer.byteLength(name, "utf8") > 240) {
    const ext = extname(name);
    const base = name.slice(0, name.length - ext.length);
    let trimmed = "";
    for (const char of base) {
      if (Buffer.byteLength(trimmed + char + ext, "utf8") > 240) break;
      trimmed += char;
    }
    name = `${trimmed || "download"}${ext}`;
  }

  return name || fallback;
}

export function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function filenameFromContentDisposition(
  header: string | null,
): string | null {
  if (!header) return null;

  const encoded = header.match(/filename\*\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (encoded) {
    const parts = encoded.split("''");
    const charset = parts.length > 1 ? parts[0]?.toLowerCase() : "utf-8";
    const value = parts.length > 1 ? parts.slice(1).join("''") : encoded;
    let decoded = decodeFilename(value.replace(/^["']|["']$/g, ""));
    if (charset === "iso-8859-1") {
      try {
        decoded = decodeURIComponent(escape(decoded));
      } catch {
        /* keep the original value */
      }
    }
    const normalized = sanitizeFileName(decoded, "");
    if (normalized && normalized !== "download") return normalized;
  }

  const quoted = header.match(/filename\s*=\s*"([^"]+)"/i)?.[1];
  if (quoted) {
    const normalized = sanitizeFileName(decodeFilename(quoted), "");
    if (normalized && normalized !== "download") return normalized;
  }

  const bare = header.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (bare) {
    const normalized = sanitizeFileName(
      decodeFilename(bare.replace(/^["']|["']$/g, "")),
      "",
    );
    if (normalized && normalized !== "download") return normalized;
  }

  return null;
}

export function filenameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return sanitizeFileName(decodeFilename(last), "download");
  } catch {
    return "download";
  }
}

export function chooseFileName(
  rawUrl: string,
  contentDisposition: string | null,
  contentType: string,
): string {
  let name =
    filenameFromContentDisposition(contentDisposition) ??
    filenameFromUrl(rawUrl);

  if (!extname(name)) {
    const ext = extensionForContentType(contentType);
    if (ext) name = `${name}.${ext}`;
  }

  return sanitizeFileName(name, "download");
}

export function partialFileName(
  fileName: string,
  start: number,
  end: number | null,
): string {
  const parsed = parse(fileName);
  const suffix = end !== null ? ` [${start}-${end}]` : ` [from ${start}]`;
  return sanitizeFileName(`${parsed.name}${suffix}${parsed.ext}`, fileName);
}

export function isPartialRange(
  start: number,
  end: number | null,
): boolean {
  return start > 0 || end !== null;
}

export function normalizeDownloadUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  url.hash = "";
  return url;
}

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

export interface ByteRange {
  start: number;
  end: number;
}

export function parseRangeHeader(
  value: string | null,
  size: number,
): ByteRange | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) return null;
  if (size <= 0) return "invalid";

  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (startRaw === "" && endRaw === "") return "invalid";

  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) return "invalid";
  if (start >= size) return "invalid";

  if (endRaw === "") return { start, end: size - 1 };
  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export interface ContentRange {
  start: number;
  end: number;
  total: number | null;
}

export function parseContentRange(value: string | null): ContentRange | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3]),
  };
}

export function headerNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value.split(",")[0]?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function humanHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function toPublicJob(
  row: DownloadRow,
  options: { speedBps?: number; fileExists?: boolean } = {},
): PublicJob {
  const total = Math.max(0, row.total_bytes);
  const downloaded = Math.max(0, row.downloaded_bytes);
  const speed = Math.max(0, Math.round(options.speedBps ?? row.speed_bps ?? 0));
  const progress =
    total > 0
      ? Math.min(100, Math.round((downloaded / total) * 1000) / 10)
      : row.status === "completed" && downloaded > 0
        ? 100
        : null;
  const etaSeconds =
    speed > 0 && total > downloaded
      ? Math.max(1, Math.ceil((total - downloaded) / speed))
      : null;
  const rangeStart = Math.max(0, row.range_start ?? 0);
  const rangeEnd = row.range_end == null ? null : Math.max(0, row.range_end);
  const isPartial = rangeStart > 0 || rangeEnd !== null;
  const remoteTotal = Math.max(0, row.remote_total ?? 0);

  return {
    id: row.id,
    url: row.url,
    finalUrl: row.final_url,
    fileName: row.file_name,
    filePath: row.file_path,
    contentType: row.content_type,
    kind: kindFor(row.content_type, row.file_name),
    totalBytes: total,
    downloadedBytes: downloaded,
    etag: row.etag,
    lastModified: row.last_modified,
    supportsRanges: Boolean(row.supports_ranges),
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    attempts: row.attempts,
    speedBps: speed,
    etaSeconds,
    progress,
    host: humanHost(row.final_url ?? row.url),
    canPreview: ["video", "audio", "image"].includes(
      kindFor(row.content_type, row.file_name),
    ),
    fileExists: options.fileExists ?? true,
    isPartial,
    rangeStart,
    rangeEnd,
    rangeIf: row.range_if,
    remoteTotal,
    httpStatus: row.http_status,
    headers: parseStoredHeaders(row.headers_json),
  };
}

export function probeToAddInput(
  probe: ProbeResult,
): Pick<
  ProbeResult,
  | "url"
  | "finalUrl"
  | "fileName"
  | "contentType"
  | "totalBytes"
  | "supportsRanges"
  | "etag"
  | "lastModified"
> {
  return {
    url: probe.url,
    finalUrl: probe.finalUrl,
    fileName: probe.fileName,
    contentType: probe.contentType,
    totalBytes: probe.totalBytes,
    supportsRanges: probe.supportsRanges,
    etag: probe.etag,
    lastModified: probe.lastModified,
  };
}

export function contentDisposition(
  fileName: string,
  type: "inline" | "attachment",
): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function sleepWithSignal(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolveSleep, rejectSleep) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

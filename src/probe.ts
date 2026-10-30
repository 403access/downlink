import type { ProbeResult, RequestHeader } from "./types";
import { buildRequestHeaders } from "./headers";
import {
  chooseFileName,
  headerNumber,
  kindFor,
  normalizeContentType,
  normalizeDownloadUrl,
  parseContentRange,
} from "./utils";

const PROBE_TIMEOUT_MS = 20_000;

export class ProbeError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "ProbeError";
    this.status = status;
  }
}

function responseIsHtml(contentType: string): boolean {
  return (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "text/xml"
  );
}

function responseIsHls(contentType: string, url: string): boolean {
  return (
    contentType === "application/vnd.apple.mpegurl" ||
    contentType === "application/x-mpegurl" ||
    contentType === "audio/mpegurl" ||
    new URL(url).pathname.toLowerCase().endsWith(".m3u8")
  );
}

function parseProbeResponse(response: Response, requestedUrl: URL): ProbeResult {
  const contentType = normalizeContentType(response.headers.get("content-type"));
  const contentRange = parseContentRange(
    response.headers.get("content-range"),
  );
  const contentLength = headerNumber(response.headers.get("content-length"));
  const finalUrl = response.url || requestedUrl.href;
  const fileName = chooseFileName(
    finalUrl,
    response.headers.get("content-disposition"),
    contentType,
  );

  const totalBytes =
    contentRange?.total ??
    (response.status === 206
      ? contentRange
        ? contentRange.end + 1
        : 0
      : contentLength);

  return {
    url: requestedUrl.href,
    finalUrl,
    fileName,
    contentType,
    kind: kindFor(contentType, fileName),
    totalBytes: Math.max(0, totalBytes),
    supportsRanges:
      response.status === 206 ||
      (response.headers.get("accept-ranges") ?? "").toLowerCase().includes("bytes"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    status: response.status,
  };
}

function httpErrorMessage(response: Response, url: URL): string {
  const status = response.status;
  const host = url.hostname;
  if (status === 401 || status === 403) {
    return `The server at ${host} refused access (HTTP ${status}). The link may be private, expired, or require a referer/cookie.`;
  }
  if (status === 404) {
    return `The file was not found at ${host} (HTTP 404).`;
  }
  if (status === 429) {
    return `The server at ${host} is rate limiting requests (HTTP 429). Try again shortly.`;
  }
  if (status >= 500) {
    return `The server at ${host} returned HTTP ${status}. Try again later.`;
  }
  return `The request failed with HTTP ${status}.`;
}

async function probeWithMethod(
  url: URL,
  method: "HEAD" | "GET",
  signal: AbortSignal,
  customHeaders: RequestHeader[],
): Promise<ProbeResult> {
  const headers = buildRequestHeaders(customHeaders);
  if (method === "GET") headers.set("Range", "bytes=0-0");

  const response = await fetch(url, {
    method,
    headers,
    redirect: "follow",
    signal,
  });

  if (!response.ok) {
    // A range request to a zero-byte file can legitimately return 416.
    if (method === "GET" && response.status === 416) {
      const range = parseContentRange(
        `bytes 0-0/${response.headers.get("content-range")?.split("/")[1] ?? "*"}`,
      );
      if (range?.total === 0) {
        return {
          url: url.href,
          finalUrl: response.url || url.href,
          fileName: chooseFileName(
            response.url || url.href,
            response.headers.get("content-disposition"),
            "application/octet-stream",
          ),
          contentType: "application/octet-stream",
          kind: "other",
          totalBytes: 0,
          supportsRanges: true,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          status: 200,
        };
      }
    }
    throw new ProbeError(httpErrorMessage(response, url), response.status);
  }

  const result = parseProbeResponse(response, url);

  if (responseIsHls(result.contentType, result.finalUrl)) {
    await response.body?.cancel();
    throw new ProbeError(
      "HLS playlists aren't supported yet. Paste a direct video or audio file URL instead.",
    );
  }

  if (responseIsHtml(result.contentType)) {
    await response.body?.cancel();
    throw new ProbeError(
      "That URL returns a web page rather than a file. Open the page and copy its direct media or download link.",
    );
  }

  // The response body is only needed for headers. Do not download it while probing.
  if (method === "GET") await response.body?.cancel();

  return result;
}

/**
 * Inspect a remote URL using HEAD, falling back to a one-byte ranged GET for
 * servers that do not implement HEAD (or reject it). This discovers size, type,
 * range support and validators without downloading the payload.
 */
export async function probeUrl(
  rawUrl: string,
  customHeaders: RequestHeader[] = [],
): Promise<ProbeResult> {
  const url = normalizeDownloadUrl(rawUrl);
  let headError: unknown = null;

  try {
    const head = await probeWithMethod(
      url,
      "HEAD",
      AbortSignal.timeout(PROBE_TIMEOUT_MS),
      customHeaders,
    );
    if (head.contentType && (head.totalBytes > 0 || head.supportsRanges)) {
      return head;
    }
  } catch (error) {
    headError = error;
    // A surprising number of CDNs return 404/405/403 for HEAD even though GET
    // works correctly. Always confirm with a real one-byte GET before failing.
  }

  try {
    return await probeWithMethod(
      url,
      "GET",
      AbortSignal.timeout(PROBE_TIMEOUT_MS),
      customHeaders,
    );
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    if (headError instanceof Error && headError.name === "TimeoutError") {
      throw new ProbeError("The remote server did not respond in time.", 504);
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ProbeError("The remote server did not respond in time.", 504);
    }
    const message =
      error instanceof Error ? error.message : "The remote server could not be reached.";
    throw new ProbeError(`Could not inspect that URL: ${message}`, 502);
  }
}

import type { RequestHeader } from "./types";

export const DOWNLOAD_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
};

const BLOCKED = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "keep-alive",
  "te",
  "trailer",
  "range",
  "if-range",
  "accept-encoding",
]);

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_ENCODER = new TextEncoder();
const MAX_HEADERS = 64;
const MAX_TOTAL_BYTES = 16_384;
const MAX_NAME_LENGTH = 256;
const MAX_VALUE_LENGTH = 8_192;

function cleanHeaderName(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanHeaderValue(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, MAX_VALUE_LENGTH);
}

/**
 * Normalize a user-supplied header list. Managed transport headers are removed
 * so callers can't break range/resume semantics or connection framing.
 */
export function normalizeRequestHeaders(input: unknown): RequestHeader[] {
  if (!input) return [];

  const candidates: Array<{ name: unknown; value: unknown }> = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === "object") {
        const value = item as { name?: unknown; value?: unknown };
        candidates.push({ name: value.name, value: value.value });
      }
    }
  } else if (typeof input === "object") {
    for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
      candidates.push({ name, value });
    }
  } else {
    return [];
  }

  const byName = new Map<string, RequestHeader>();
  let totalBytes = 0;
  for (const candidate of candidates) {
    const name = cleanHeaderName(candidate.name);
    if (
      !name ||
      name.length > MAX_NAME_LENGTH ||
      !TOKEN.test(name) ||
      BLOCKED.has(name.toLowerCase())
    ) {
      continue;
    }
    const value = cleanHeaderValue(candidate.value);
    const size =
      HEADER_ENCODER.encode(name).byteLength +
      HEADER_ENCODER.encode(value).byteLength;
    if (totalBytes + size > MAX_TOTAL_BYTES) break;
    totalBytes += size;
    byName.set(name.toLowerCase(), { name, value });
    if (byName.size >= MAX_HEADERS) break;
  }

  return [...byName.values()];
}

export function parseStoredHeaders(json: string | null | undefined): RequestHeader[] {
  if (!json) return [];
  try {
    return normalizeRequestHeaders(JSON.parse(json));
  } catch {
    return [];
  }
}

export function storedHeadersJson(headers: RequestHeader[]): string {
  return JSON.stringify(normalizeRequestHeaders(headers));
}

export function buildRequestHeaders(headers: RequestHeader[] = []): Headers {
  const result = new Headers(DOWNLOAD_HEADERS);
  for (const header of normalizeRequestHeaders(headers)) {
    result.set(header.name, header.value);
  }
  // Range correctness requires a one-to-one byte mapping.
  result.set("Accept-Encoding", "identity");
  return result;
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { buildRequestHeaders, normalizeRequestHeaders } from "../headers";
import type { RequestHeader } from "../types";
import { normalizeDownloadUrl } from "../utils";
import { HttpError } from "./http";

const PREVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const PREVIEW_SECRET = randomBytes(32);

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function makePreviewToken(
  rawUrl: string,
  headers: RequestHeader[] = [],
): string {
  const payload = Buffer.from(
    JSON.stringify({
      u: rawUrl,
      e: Date.now() + PREVIEW_TTL_MS,
      h: headers,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", PREVIEW_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function readPreviewToken(token: string): {
  url: URL;
  headers: RequestHeader[];
} {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new HttpError("Invalid preview token.", 403);
  const expected = createHmac("sha256", PREVIEW_SECRET)
    .update(payload)
    .digest("base64url");
  if (!safeCompare(signature, expected)) {
    throw new HttpError("Invalid preview token.", 403);
  }
  let parsed: { u?: unknown; e?: unknown; h?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      u?: unknown;
      e?: unknown;
      h?: unknown;
    };
  } catch {
    throw new HttpError("Invalid preview token.", 403);
  }
  if (typeof parsed.e !== "number" || parsed.e < Date.now()) {
    throw new HttpError("This preview link expired. Inspect the URL again.", 403);
  }
  if (typeof parsed.u !== "string") throw new HttpError("Invalid preview token.", 403);
  return {
    url: normalizeDownloadUrl(parsed.u),
    headers: normalizeRequestHeaders(parsed.h),
  };
}

export async function remotePreviewResponse(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) throw new HttpError("Missing preview token.", 403);
  const preview = readPreviewToken(token);
  const headers = buildRequestHeaders(preview.headers);
  if (req.method === "GET") {
    const range = req.headers.get("range");
    if (range) headers.set("Range", range);
    const ifRange = req.headers.get("if-range");
    if (ifRange) headers.set("If-Range", ifRange);
  }

  const upstream = await fetch(preview.url, {
    method: req.method === "HEAD" ? "HEAD" : "GET",
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
}

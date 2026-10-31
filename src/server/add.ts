import { probeUrl } from "../probe";
import type { PartialRangeOptions, RequestHeader } from "../types";
import { engine, MAX_BATCH, PROBE_CONCURRENCY } from "./context";
import { HttpError } from "./http";

export function parsePartialRange(raw: unknown): PartialRangeOptions | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError("The range must be an object with start/end bytes.", 400);
  }
  const value = raw as Record<string, unknown>;
  const startRaw = value.start ?? 0;
  const start = Number(startRaw);
  if (!Number.isInteger(start) || start < 0) {
    throw new HttpError("Range start must be a non-negative integer.", 400);
  }

  const rawEnd = value.end ?? value.endByte ?? null;
  const end =
    rawEnd === null || rawEnd === undefined || rawEnd === ""
      ? null
      : Number(rawEnd);
  if (end !== null && (!Number.isInteger(end) || end < start)) {
    throw new HttpError("Range end must be an integer at or after the start.", 400);
  }
  if (start === 0 && end === null) {
    throw new HttpError("Enter a start byte or an end byte for a partial download.", 400);
  }

  const rawIfRange = value.ifRange ?? value.if_range;
  const ifRange =
    typeof rawIfRange === "string" && rawIfRange.trim()
      ? rawIfRange.replace(/[\r\n]/g, " ").trim().slice(0, 1024)
      : null;

  return { start, end, ifRange };
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

export async function addUrls(
  rawUrls: string[],
  range: PartialRangeOptions | null = null,
  headers: RequestHeader[] = [],
) {
  const urls = [...new Set(rawUrls.map((value) => value.trim()).filter(Boolean))];
  if (urls.length === 0) throw new HttpError("Paste at least one URL.", 400);
  if (urls.length > MAX_BATCH) {
    throw new HttpError(`You can add up to ${MAX_BATCH} URLs at once.`, 400);
  }
  if (range && urls.length > 1) {
    throw new HttpError("A partial range can only be used with one URL.", 400);
  }

  const results = await withConcurrency(urls, PROBE_CONCURRENCY, async (url) => {
    try {
      const probe = await probeUrl(url, headers);
      const job = engine.addDownload(
        probe,
        engine.getSettings().downloadDir,
        range ?? undefined,
        headers,
      );
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

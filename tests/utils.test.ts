import { describe, expect, test } from "bun:test";
import {
  chooseFileName,
  contentTypeForFile,
  filenameFromContentDisposition,
  kindFor,
  normalizeContentType,
  normalizeDownloadUrl,
  parseContentRange,
  parseRangeHeader,
  sanitizeFileName,
  toPublicJob,
} from "../src/utils";
import type { DownloadRow } from "../src/types";

describe("safe filenames", () => {
  test("strips path traversal and separators", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\windows\\system32\\file.txt")).toBe("file.txt");
    expect(sanitizeFileName("folder/sub/file.mp4")).toBe("file.mp4");
  });

  test("removes unsafe control and reserved characters", () => {
    expect(sanitizeFileName('hello\u0000:world?.mp4')).toBe("hello-world-.mp4");
    expect(sanitizeFileName("con.txt")).toBe("_con.txt");
    expect(sanitizeFileName("   ")).toBe("download");
  });

  test("preserves an extension when truncating", () => {
    const result = sanitizeFileName(`${"a".repeat(250)}.mp4`);
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith(".mp4")).toBe(true);
  });

  test("keeps the UTF-8 filename within filesystem byte limits", () => {
    const result = sanitizeFileName(`${"😀".repeat(200)}.mp4`);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(240);
    expect(result.endsWith(".mp4")).toBe(true);
  });
});

describe("content disposition", () => {
  test("reads quoted and RFC 5987 filenames", () => {
    expect(filenameFromContentDisposition('attachment; filename="My Video.mp4"')).toBe(
      "My Video.mp4",
    );
    expect(
      filenameFromContentDisposition(
        "attachment; filename*=UTF-8''Lily%20Phillips%20Video.mp4",
      ),
    ).toBe("Lily Phillips Video.mp4");
  });

  test("falls back to the URL and infers missing extensions", () => {
    expect(
      chooseFileName(
        "https://example.com/media/clip",
        'attachment; filename="Summer Clip"',
        "video/mp4",
      ),
    ).toBe("Summer Clip.mp4");
    expect(chooseFileName("https://example.com/a/b/file.mkv", null, "")).toBe(
      "file.mkv",
    );
  });
});

describe("byte ranges", () => {
  test("parses common range forms", () => {
    expect(parseRangeHeader("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader("bytes=-50", 1000)).toEqual({ start: 950, end: 999 });
    expect(parseRangeHeader("bytes=0-9999", 1000)).toEqual({ start: 0, end: 999 });
  });

  test("rejects unsatisfiable or malformed ranges", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toBe("invalid");
    expect(parseRangeHeader("bytes=500-400", 1000)).toBe("invalid");
    expect(parseRangeHeader("bytes=-0", 1000)).toBe("invalid");
    expect(parseRangeHeader("items=0-1", 1000)).toBe(null);
    expect(parseRangeHeader(null, 1000)).toBe(null);
  });

  test("parses content-range", () => {
    expect(parseContentRange("bytes 100-199/1000")).toEqual({
      start: 100,
      end: 199,
      total: 1000,
    });
    expect(parseContentRange("bytes 0-0/*")).toEqual({
      start: 0,
      end: 0,
      total: null,
    });
    expect(parseContentRange("nope")).toBe(null);
  });
});

describe("media types", () => {
  test("normalizes octet-stream and infers kind", () => {
    expect(normalizeContentType("application/octet-stream", "movie.mp4")).toBe(
      "video/mp4",
    );
    expect(kindFor("application/octet-stream", "song.flac")).toBe("audio");
    expect(kindFor("image/png")).toBe("image");
    expect(kindFor("application/pdf", "x.pdf")).toBe("document");
    expect(contentTypeForFile("archive.zip", "application/octet-stream")).toBe(
      "application/zip",
    );
  });
});

describe("URL and job normalization", () => {
  test("accepts only http(s)", () => {
    expect(normalizeDownloadUrl("https://example.com/a.mp4#x").href).toBe(
      "https://example.com/a.mp4",
    );
    expect(() => normalizeDownloadUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizeDownloadUrl("not a url")).toThrow();
  });

  test("builds progress and ETA", () => {
    const row: DownloadRow = {
      id: "id",
      url: "https://example.com/file.mp4",
      final_url: "https://example.com/file.mp4",
      file_name: "file.mp4",
      file_path: "/tmp/file.mp4",
      content_type: "video/mp4",
      total_bytes: 1000,
      downloaded_bytes: 250,
      etag: '"abc"',
      last_modified: null,
      supports_ranges: 1,
      status: "downloading",
      error: null,
      created_at: 1,
      updated_at: 2,
      started_at: 2,
      completed_at: null,
      attempts: 1,
      speed_bps: 0,
      range_start: 0,
      range_end: null,
      range_if: null,
      remote_total: 1000,
      http_status: 206,
    };
    const job = toPublicJob(row, { speedBps: 125, fileExists: true });
    expect(job.progress).toBe(25);
    expect(job.etaSeconds).toBe(6);
    expect(job.kind).toBe("video");
    expect(job.host).toBe("example.com");
    expect(job.canPreview).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, partPathFor } from "../src/db";
import { DownloadEngine } from "../src/engine";
import { probeUrl } from "../src/probe";
import type { AppSettings } from "../src/types";

const FILE_SIZE = 2 * 1024 * 1024;
const ETAG = '"engine-fixture-v1"';
const buffer = new Uint8Array(FILE_SIZE);
for (let index = 0; index < buffer.length; index += 1) {
  buffer[index] = index % 251;
}

const rangeRequests: string[] = [];
const ifRangeRequests: string[] = [];
const forwardedHeaders: Array<Record<string, string>> = [];

let fixture: ReturnType<typeof Bun.serve>;
let tempDir: string;
let store: Store;
let engine: DownloadEngine;
let settings: AppSettings;

beforeAll(async () => {
  fixture = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/test.bin") {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers({
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        ETag: ETAG,
        "Last-Modified": "Tue, 15 Sep 2026 00:23:27 GMT",
        "Content-Disposition": 'attachment; filename="engine-test.bin"',
      });

      if (req.method === "HEAD") {
        headers.set("Content-Length", String(FILE_SIZE));
        return new Response(null, { headers });
      }

      forwardedHeaders.push(Object.fromEntries(req.headers.entries()));
      const range = req.headers.get("range");
      if (range) {
        rangeRequests.push(range);
        const ifRange = req.headers.get("if-range");
        if (ifRange) ifRangeRequests.push(ifRange);
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) return new Response("bad range", { status: 416 });
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), FILE_SIZE - 1) : FILE_SIZE - 1;
        if (start >= FILE_SIZE) {
          headers.set("Content-Range", `bytes */${FILE_SIZE}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set("Content-Range", `bytes ${start}-${end}/${FILE_SIZE}`);
        headers.set("Content-Length", String(end - start + 1));
        return new Response(buffer.slice(start, end + 1), { status: 206, headers });
      }

      headers.set("Content-Length", String(FILE_SIZE));
      return new Response(buffer, { headers });
    },
  });

  tempDir = await mkdtemp(join(tmpdir(), "downlink-test-"));
  store = new Store(join(tempDir, "test.db"));
  settings = {
    downloadDir: join(tempDir, "downloads"),
    maxConcurrent: 1,
    speedLimitBps: 200_000,
  };
  engine = new DownloadEngine(store, settings);
});

afterAll(async () => {
  await engine.shutdown();
  fixture.stop(true);
  store.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for download state.");
    }
    await Bun.sleep(40);
  }
}

describe("download engine", () => {
  test("probes, pauses and resumes with a byte range", async () => {
    const url = `http://127.0.0.1:${fixture.port}/test.bin`;
    const probe = await probeUrl(url);
    expect(probe.totalBytes).toBe(FILE_SIZE);
    expect(probe.supportsRanges).toBe(true);
    expect(probe.etag).toBe(ETAG);
    expect(probe.fileName).toBe("engine-test.bin");

    const job = engine.addDownload(probe, settings.downloadDir);
    await waitFor(() => {
      const current = engine.getPublicJob(job.id);
      return (
        current?.status === "downloading" && current.downloadedBytes > 0
      );
    });

    const paused = await engine.pause(job.id);
    expect(paused).toBe(true);
    const pausedJob = engine.getPublicJob(job.id);
    expect(pausedJob?.status).toBe("paused");
    const partPath = partPathFor(pausedJob?.filePath ?? job.filePath);
    expect(existsSync(partPath)).toBe(true);
    const pausedBytes = (await stat(partPath)).size;
    expect(pausedBytes).toBeGreaterThan(0);
    expect(pausedBytes).toBeLessThan(FILE_SIZE);

    engine.setSettings({ ...settings, speedLimitBps: 0 });
    expect(await engine.resume(job.id)).toBe(true);
    await waitFor(() => engine.getPublicJob(job.id)?.status === "completed");

    const completed = engine.getPublicJob(job.id);
    expect(completed?.downloadedBytes).toBe(FILE_SIZE);
    expect(completed?.progress).toBe(100);
    expect(completed?.filePath.endsWith("engine-test.bin")).toBe(true);
    expect(existsSync(completed?.filePath ?? "")).toBe(true);

    const saved = new Uint8Array(await readFile(completed?.filePath ?? ""));
    expect(saved.byteLength).toBe(FILE_SIZE);
    expect(saved[0]).toBe(buffer[0]);
    expect(saved[FILE_SIZE - 1]).toBe(buffer[FILE_SIZE - 1]);

    expect(
      rangeRequests.some((range) => range === `bytes=${pausedBytes}-`),
    ).toBe(true);
    expect(ifRangeRequests).toContain(ETAG);
    expect(existsSync(partPath)).toBe(false);
  }, 20_000);

  test("downloads an explicit 206 byte range and records it", async () => {
    engine.setSettings({ ...settings, speedLimitBps: 0 });
    const url = `http://127.0.0.1:${fixture.port}/test.bin`;
    const probe = await probeUrl(url);
    const start = 1_200_000;
    const end = 1_700_000;

    const job = engine.addDownload(
      probe,
      settings.downloadDir,
      {
        start,
        end,
        ifRange: ETAG,
      },
      [
        { name: "Referer", value: "https://example.test/watch" },
        { name: "X-Client", value: "downlink-test" },
      ],
    );
    await waitFor(() => engine.getPublicJob(job.id)?.status === "completed");

    const completed = engine.getPublicJob(job.id);
    expect(completed?.isPartial).toBe(true);
    expect(completed?.rangeStart).toBe(start);
    expect(completed?.rangeEnd).toBe(end);
    expect(completed?.remoteTotal).toBe(FILE_SIZE);
    expect(completed?.httpStatus).toBe(206);
    expect(completed?.downloadedBytes).toBe(end - start + 1);
    expect(completed?.fileName).toContain(`[${start}-${end}]`);
    expect(completed?.headers).toContainEqual({
      name: "Referer",
      value: "https://example.test/watch",
    });
    expect(rangeRequests).toContain(`bytes=${start}-${end}`);
    expect(ifRangeRequests).toContain(ETAG);
    expect(
      forwardedHeaders.some(
        (headers) =>
          headers["referer"] === "https://example.test/watch" &&
          headers["x-client"] === "downlink-test",
      ),
    ).toBe(true);

    const saved = new Uint8Array(await readFile(completed?.filePath ?? ""));
    const expected = buffer.slice(start, end + 1);
    expect(saved.byteLength).toBe(expected.byteLength);
    expect(Buffer.from(saved).equals(Buffer.from(expected))).toBe(true);
  }, 20_000);
});
